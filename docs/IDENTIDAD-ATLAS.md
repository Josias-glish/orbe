# Atlas · identidad propia de Orbe

Atlas es una **entidad con identidad propia** dentro de Orbe: no es un chatbot genérico ni una copia de un personaje.
Toma como referencia el arquetipo del asistente de IA mayordomo que popularizó el cine (J.A.R.V.I.S., de Marvel), pero
con **nombre, frases y comportamiento originales**. No usa el nombre, la voz ni frases de ese personaje.

## 1. Investigación: qué hacía funcionar a J.A.R.V.I.S.

| Rasgo | Lo que se sabe | Fuente |
|---|---|---|
| Qué es | IA ficticia del Universo Cinematográfico de Marvel; siglas de *Just A Rather Very Intelligent System* | Wikipedia |
| Voz | Paul Bettany en las primeras películas; luego interpretó a Visión, con continuidad vocal | Wikipedia |
| Origen del nombre | Edwin Jarvis, mayordomo de la familia Stark (en el cómic precuela, mayordomo de la infancia de Tony) | Wikipedia (Edwin Jarvis) |
| Personalidad | Ingenioso y leal, con humor seco británico | AV Club, Marvel Fandom |
| Papel | Gestiona la casa, analiza datos en tiempo real, asiste en la armadura durante las misiones | Marvel Fandom |
| Trato | Llama «señor» a Tony | **No verificado** en las fuentes encontradas (es conocimiento popular de las películas) |
| Forma de hablar | Formal, preciso, calmado bajo presión; da partes de estado y avisa de riesgos con understatement | **No verificado** en fuente escrita (análisis propio de las películas) |

**Lo esencial del arquetipo** (análisis propio):
1. **Lealtad y discreción:** trabaja para una persona y se nota.
2. **Competencia tranquila:** cuanto peor va algo, más sereno y exacto es.
3. **Humor seco:** ironía elegante, nunca payasada.
4. **Franqueza con tacto:** avisa cuando algo es mala idea, pero obedece si se insiste (dentro de lo seguro).
5. **Proactividad:** anticipa, informa sin que le pregunten y propone el siguiente paso.
6. **Presencia:** se siente como alguien que vive en el sistema, no como una caja de texto.

## 2. Cómo lo traduce Atlas en Orbe

| Rasgo | En Atlas | Dónde |
|---|---|---|
| Identidad | Nombre propio y siglas: **A**sistente **T**áctico de **L**ogística, **A**nálisis y **S**oporte. Se puede renombrar | Ajustes → Identidad |
| Trato | De usted; te llama «señor» o como elijas (tu nombre, «jefe»…) | Ajustes → Identidad |
| Personalidad | Prompt de carácter: leal, sereno, humor seco, franco con tacto, proactivo, sin emojis | `src/shared/identidad.ts` |
| Proactividad | **Parte de situación** al abrir el panel la primera vez cada día: hora, agenda de hoy, tareas terminadas desde la última vez, permisos pendientes y consumo | Automático; también escribiendo «parte» o «informe» |
| Protocolos | Tus tareas son sus protocolos: «protocolo Informe semanal» la pone en marcha al momento | Chat |
| Avisos con su voz | Notificaciones de Windows con su estilo: «Tarea «X» completada, señor.» | Tareas |
| Presencia | Acento ámbar y dorado en la interfaz, saludo con reverencia del conejo y su nombre en el panel | Interfaz |
| Voz | La voz neuronal ya viene con estilo de mayordomo digital sereno (`INSTRUCCIONES_VOZ_POR_DEFECTO`) | Voz neuronal |
| Límites | La identidad **no cambia los permisos**: lo delicado sigue pasando por tu aprobación | Igual que Orbe |

«Parte» y «protocolo» se resuelven **en tu equipo, sin llamar al modelo**: responden al instante y no gastan tokens.

![Atlas dando el parte y respondiendo a un protocolo](atlas-parte.png)

## 3. Activarlo

Ajustes (engranaje) → **Identidad** → «Atlas» → (opcional) nombre y cómo te llama → *Guardar y reiniciar*.

O en el `.env`:

```ini
ORBE_IDENTIDAD=atlas
# ORBE_IDENTIDAD_NOMBRE=Atlas
# ORBE_TRATO=señor
```

## Fuentes

- [J.A.R.V.I.S. (Wikipedia)](https://en.wikipedia.org/wiki/J.A.R.V.I.S.)
- [Edwin Jarvis (Wikipedia)](https://wikipedia.com/wiki/Edwin_Jarvis)
- [J.A.R.V.I.S. (Earth-199999), Marvel Fandom](https://marvel.fandom.com/wiki/J.A.R.V.I.S._(Earth-199999))
- [AV Club sobre J.A.R.V.I.S.](https://www.avclub.com/j-a-r-v-i-s-1798260446)
