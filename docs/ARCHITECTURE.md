# Arquitectura del MVP RevisaTuCuenta

## Objetivo de esta versión

El MVP cubre el recorrido del paciente desde la portada hasta el dashboard de un caso. Permite crear el expediente, cargar documentos juntos o separados, confirmar su clasificación, validar si existe la documentación mínima, ejecutar un procesamiento preliminar y revisar resultados trazables.

## Superficies

- `app/page.tsx`: experiencia completa del paciente como flujo guiado.
- `app/api/cases`: creación y persistencia del expediente.
- `app/api/documents`: almacenamiento privado del archivo original y de sus metadatos.
- `db/schema.ts`: modelo relacional extensible.
- `worker/index.ts`: entrada de la aplicación y bindings de infraestructura.

## Persistencia y trazabilidad

- D1 guarda casos, metadatos de documentos y campos extraídos.
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

## Caso emblemático

`CUENTA INDISA_APENDICITIS.pdf` es un PDF escaneado de 22 páginas. La inspección visual identifica la cuenta clínica INDISA en las páginas 1–8 y documentos PAM/liquidaciones de Nueva Masvida en las páginas 9–22. El MVP lo representa como un documento mixto con dos segmentos y mantiene esos rangos como fuente.

## Límites deliberados del MVP

- La clasificación de archivos nuevos usa señales del nombre y permite confirmación humana.
- El caso emblemático utiliza su segmentación ya verificada visualmente.
- El OCR clínico, la reconstrucción financiera y el motor contractual son las siguientes capas; el dashboard ya reserva su estado y sus contratos de datos.
- El resultado se presenta como preliminar y no afirma por sí solo un cobro indebido.
