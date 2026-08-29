# Arquitectura del MVP RevisaTuCuenta

## Motor de reglas de fragmentación / unbundling

El análisis no trata todo cobro separado como improcedente. `lib/rules/unbundling.ts` mantiene un catálogo versionable de reglas, su fuente, ámbito de aplicación y evidencia mínima. Cada evaluación devuelve uno de cuatro estados:

- `candidate`: existe una coincidencia que requiere explicación o antecedentes adicionales;
- `cleared`: la evidencia disponible no activa la regla;
- `not_evaluable`: faltan datos indispensables;
- `informational`: existe un antecedente del pagador que debe conservarse, pero no resuelve por sí solo el caso.

Las reglas FONASA MLE sirven como regla decisoria solo cuando ese régimen resulta aplicable. En cuentas de Isapre convencional se usan para detectar coincidencias y formular preguntas; la conclusión exige acreditar el contrato, convenio o arancel que rige la cuenta. Cada línea analizada conserva archivo, página, contexto y monto.

### Clasificación probabilística de cuentas chilenas

`lib/rules/chilean-account.ts` ejecuta la primera fase sin PAM. Normaliza el lenguaje usado por prestadores chilenos (`hospitalización transitoria`, `pabellón transitorio`, `materiales clínicos`, `farmacia`, `ajustes`) y devuelve probabilidades de pertenencia a una prestación principal. La probabilidad no equivale a improcedencia: expresa qué tan plausible es que una línea deba contrastarse con pabellón, estancia u otro paquete.

El conocimiento es versionable y declara autoridad, estado, alcance y fuente. Las listas técnicas no se tratan como exhaustivas. Un material desconocido permanece incierto hasta que un contrato, convenio, revisión clínica o resolución regulatoria permita elevar o reducir la confianza. Las resoluciones futuras se incorporan mediante `knowledgeFromAdjudication`, conservando su alcance contractual en vez de convertirlas en reglas universales.

La fase de cuenta clínica también detecta:

- duplicados exactos candidatos, sin confundir cantidades, profesionales o factores arancelarios;
- líneas de valor cero como marcadores de posible inclusión;
- glosas opacas como `ajustes` o `varios`;
- procedimientos simultáneos y factores porcentuales;
- un mismo episodio facturado por varias razones sociales.

El PAM se reserva para una segunda fase: conciliación, cobertura, rechazo y traslado del costo al paciente.

La ruta `POST /api/analysis` recibe los renglones previamente extraídos del PDF y ejecuta este motor conservando la página y el identificador documental. El cargador usa PDF.js para leer texto directo y Tesseract.js para páginas escaneadas; cuando encuentra señales de cuenta y PAM en el mismo archivo, segmenta ambos documentos por página antes de persistirlos.

### Corpus observado y equivalencia de insumos

`data/learning/observed-item-patterns.json` incorpora de forma desidentificada trece cuentas revisadas: 1.468 observaciones y 664 patrones de glosa. Cada caso declara si su extracción concilia con el total fuente o si corresponde a un subconjunto verificado. El corpus no contiene nombres, RUT, domicilios, teléfonos, fechas de atención ni números de cuenta.

`lib/rules/observed-corpus.ts` calcula una probabilidad separada de equivalencia usando descripción normalizada, código interno, código FONASA y similitud de palabras. Esta familiaridad permite reconocer el mismo producto o familia cuando cambia la glosa o el código del prestador. No eleva por sí sola la probabilidad de fragmentación: la inclusión económica sigue dependiendo del paquete clínico y de evidencia contractual o regulatoria.

## Objetivo de esta versión

Las vistas paciente y desarrollador operan sobre el mismo expediente persistido. El paciente puede crear un caso y cargar la cuenta clínica y el PAM; el desarrollador puede seleccionar casos, incorporar o reemplazar fuentes, ejecutar el análisis, revisar la matriz técnica y exportar el estado del expediente.

## Superficies

- `app/page.tsx`: enrutamiento de las superficies públicas, paciente y desarrollador.
- `app/operational-portal.tsx`: vistas operativas que leen y escriben el expediente mediante las rutas de la aplicación.
- `app/api/cases`: creación y persistencia del expediente.
- `app/api/cases/[id]`: lectura consolidada de caso, documentos, análisis, autorización y actividad.
- `app/api/cases/[id]/authorization`: registro persistente de autorización para gestión de reclamos.
- `app/api/documents`: almacenamiento privado del archivo original y de sus metadatos.
- `app/api/extractions`: persistencia del JSON estructurado además de los campos trazables.
- `app/api/analysis`: análisis probabilístico de líneas ya extraídas de una cuenta clínica.
- `db/schema.ts`: modelo relacional extensible.
- `worker/index.ts`: entrada de la aplicación y bindings de infraestructura.

## Persistencia y trazabilidad

- D1 guarda casos, metadatos de documentos, extracciones completas, análisis, autorizaciones y actividad.
- R2 guarda los bytes de cada documento original.
- Cada documento conserva nombre original, tipo MIME, tamaño, clasificación, confianza y clave de almacenamiento.
- Cada campo extraído se vincula a `document_id`, página, zona de origen y confianza. Las correcciones futuras deben crear una revisión; nunca sobrescribir silenciosamente la evidencia.

## Pipeline previsto

1. Ingesta segura y huella del archivo.
2. Detección de documento único o mixto.
3. Segmentación por rangos de páginas.
4. OCR y extracción estructurada con coordenadas.
5. Normalización de códigos, prestadores, fechas y montos.
6. Reconstrucción de la cuenta por rubros y episodios.
7. Cruce Cuenta clínica ↔ uno o varios PAM.
8. Aplicación de reglas del contrato y sus topes.
9. Hallazgos con evidencia y nivel de certeza.
10. Reclamos versionados y seguimiento de respuestas.

### Conducta institucional y dimensión humana

`lib/rules/institutional-conduct.ts` compara la pregunta formulada, la respuesta institucional y las correcciones posteriores. Detecta evasión de preguntas concretas, traslado de la carga de aclaración al paciente, brechas entre lenguaje tranquilizador y decisión material, y cambios de posición después de un escalamiento.

Esta capa separa siempre tres niveles: hecho documental, inferencia conductual e intención no demostrada. Puede señalar que una secuencia es compatible con opacidad estratégica o con fricción institucional que favorece el abandono del reclamo, pero no etiqueta fraude, engaño, mala fe ni rasgos psicológicos como hechos sin evidencia adicional.

## Caso emblemático

`CUENTA INDISA_APENDICITIS.pdf` es un PDF escaneado de 22 páginas. La inspección visual identifica la cuenta clínica INDISA en las páginas 1–8 y documentos PAM/liquidaciones de Nueva Masvida en las páginas 9–22. El MVP lo representa como un documento mixto con dos segmentos y mantiene esos rangos como fuente.

## Límites deliberados del MVP

- La clasificación inicial de archivos nuevos usa señales del nombre, pero la lectura también revisa el contenido y puede detectar un PDF mixto cuenta/PAM.
- Un fallo de lectura deja el original cifrado temporalmente, muestra el error en desarrollo y permite reemplazar o descargar el original para una revisión humana/LLM externa.
- El OCR clínico y la reconstrucción financiera básica están conectados al cargador. El motor contractual y los reclamos enviados siguen siendo capas posteriores.
- El paquete de revisión humana/LLM se genera localmente desde la evidencia extraída. No envía datos a terceros ni modifica código automáticamente.
- El resultado se presenta como preliminar y no afirma por sí solo un cobro indebido.
