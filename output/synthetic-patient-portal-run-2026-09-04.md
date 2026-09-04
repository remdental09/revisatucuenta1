# Prueba del portal paciente — batería sintética

Fecha: 2026-09-04  
Entorno: local volátil de entrenamiento  
Sesión de acceso: `lpaulr@gmail.com`  
Suite: `synthetic-06f32a47-3495-4a33-9050-e15956623531`

Todos los casos son simulados y se mantuvieron sin identidad clínica real. Los montos son estimaciones preliminares del motor; no representan una devolución garantizada.

| Cuenta | Perfil | Resultado paciente | Cargos observados | Monto aproximado | Enlace local |
|---:|---|---|---:|---:|---|
| 01 | Hospitalización general | Irregularidades detectadas | 19 | $48.327 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-01) |
| 02 | Hospitalización pediátrica | Irregularidades detectadas | 2 | $18.333 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-02) |
| 03 | Pabellón quirúrgico | Irregularidades detectadas | 45 | $9.869.520 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-03) |
| 04 | Pabellón y anestesia | Irregularidades detectadas | 24 | $2.593.364 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-04) |
| 05 | Medicamentos hospitalizados | Irregularidades detectadas | 196 | $1.058.379 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-05) |
| 06 | Urgencia y observación | Irregularidades detectadas | 58 | $126.049 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-06) |
| 07 | Neonatal y cuidados críticos | Irregularidades detectadas | 14 | $135.325 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-07) |
| 08 | Maternidad y parto | Irregularidades detectadas | 3 | $1.377.673 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-08) |
| 09 | Hospitalización oncológica | Análisis completado; sin irregularidades evidentes | 0 | $0 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-09) |
| 10 | Cuenta mixta para revisión | Irregularidades detectadas | 2 | $21.667 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-10) |
| 11 | Hospitalización general | Irregularidades detectadas | 14 | $74.817 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-11) |
| 12 | Pabellón quirúrgico | Irregularidades detectadas | 45 | $2.302.165 | [Abrir](http://localhost:3099/?view=patient&case=synthetic-06f32a47-3495-4a33-9050-e15956623531-12) |

## Resultado técnico

- 12/12 URLs de caso cargaron en vista paciente con la sesión de entrenamiento.
- 11/12 mostraron irregularidades preliminares; 1/12 no mostró irregularidades evidentes.
- La pantalla paciente comunicó directamente el resultado y el monto aproximado, sin exponer la matriz técnica.
- No se aceptó contrato, no se inició pago y no se enviaron 12 correos nuevos.
- El correo de producción se verificó previamente: el enlace de acceso llegó a `lpaulr@gmail.com` y abrió el portal.
