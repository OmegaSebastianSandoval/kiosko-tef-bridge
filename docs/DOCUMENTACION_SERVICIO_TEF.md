# Documentación Técnica — Servicio Puente TEF II (tef-bridge-node-v1)

> **Audiencia:** desarrolladores que necesiten entender, mantener o extender la integración con el datáfono Credibanco.  
> **Protocolo cubierto:** TEF II Credibanco — transacción de **Compra con envío de PAN**.

---

## Tabla de contenido

1. [¿Qué es este servicio?](#1-qué-es-este-servicio)
2. [Estructura del proyecto](#2-estructura-del-proyecto)
3. [Configuración: `config.json` vs `.env`](#3-configuración-configjson-vs-env)
4. [Protocolo TEF II — Conceptos clave](#4-protocolo-tef-ii--conceptos-clave)
5. [Construcción de tramas (frames) para Compra con PAN](#5-construcción-de-tramas-frames-para-compra-con-pan)
   - [5.1 Trama de Handshake](#51-trama-de-handshake)
   - [5.2 Trama de Compra con PAN](#52-trama-de-compra-con-pan)
   - [5.3 Cálculo de LENGTH (BCD)](#53-cálculo-de-length-bcd)
   - [5.4 Cálculo de LRC](#54-cálculo-de-lrc)
   - [5.5 Formato de cada Campo de datos](#55-formato-de-cada-campo-de-datos)
6. [Flujo completo de una compra](#6-flujo-completo-de-una-compra)
7. [Parseo de la respuesta](#7-parseo-de-la-respuesta)
8. [Endpoints HTTP disponibles](#8-endpoints-http-disponibles)
9. [Comunicación serial (`SerialManager`)](#9-comunicación-serial-serialmanager)
10. [Códigos de respuesta del datáfono](#10-códigos-de-respuesta-del-datáfono)

---

## 1. ¿Qué es este servicio?

`tef-bridge-node-v1` es un servidor HTTP escrito en Node.js que actúa como **puente** entre la aplicación web (PHP/Totem) y el datáfono físico Credibanco.

```
 Aplicación PHP          tef-bridge (Node.js)         Datáfono Credibanco
 ┌───────────┐  HTTP     ┌──────────────────┐  RS-232  ┌──────────────┐
 │  Kiosko   │ ───────►  │     Express      │ ───────► │  Datafono    │
 │  (PHP)    │ ◄───────  │  + SerialPort    │ ◄─────── │  (TEF II)    │
 └───────────┘  JSON     └──────────────────┘  Serial  └──────────────┘
```

El servidor recibe peticiones HTTP con los datos de la venta, **construye las tramas binarias** que entiende el datáfono según el protocolo TEF II de Credibanco, las envía por el puerto serial, espera la respuesta y la devuelve como JSON a la aplicación.

---

## 2. Estructura del proyecto

```
tef-bridge-node-v1/
├── index.js              # Punto de entrada: Express + arranque del servicio
├── config.json           # Configuración estática (servidor, serial, TEF)
├── .env                  # Variables de entorno (puerto serial, timeouts, etc.)
├── .env.example          # Plantilla del .env (commitear esto, NO el .env real)
├── lib/
│   ├── TEFProtocol.js    # Construcción y parseo de tramas TEF II ⬅ núcleo
│   ├── SerialManager.js  # Comunicación por puerto serial (RS-232)
│   └── logger.js         # Logger Winston (consola + archivos)
├── routes/
│   └── api.js            # Endpoints HTTP (purchase, health, status…)
├── logs/                 # Logs generados automáticamente
├── docs/
│   └── API.md            # (archivo reservado para documentación de API)
└── tests/
    └── tef-protocol.test.js
```

---

## 3. Configuración: `config.json` vs `.env`

Hay **dos archivos de configuración** distintos con propósitos diferentes. Los valores de `.env` tienen **prioridad** a la hora de ejecutar, ya que se leen con `dotenv`.

### 3.1 `config.json` — configuración estática por defecto

Es el archivo JSON que se carga al arrancar. Define los **valores por defecto** que se usan si no se sobreescriben vía `.env`.

| Sección                           | Clave              | Descripción                                                                        |
| --------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `server.port`                     | `3000`             | Puerto TCP donde Express escucha peticiones HTTP                                   |
| `server.host`                     | `"localhost"`      | Dirección de enlace del servidor HTTP                                              |
| `server.cors_origins`             | array de URLs      | Lista blanca de orígenes permitidos por CORS (la app PHP debe estar aquí)          |
| `serial.port`                     | `"COM3"`           | **Puerto serial del datáfono** (en Windows: `COM3`, en Linux: `/dev/ttyUSB0`)      |
| `serial.baudRate`                 | `9600`             | Velocidad de comunicación serial en baudios                                        |
| `serial.dataBits`                 | `8`                | Bits de datos por trama serial                                                     |
| `serial.stopBits`                 | `1`                | Bits de parada                                                                     |
| `serial.parity`                   | `"none"`           | Paridad (sin paridad)                                                              |
| `serial.autoOpen`                 | `false`            | No abrir el puerto automáticamente al instanciar                                   |
| `serial.timeout`                  | `120000`           | Timeout general en ms (2 minutos)                                                  |
| `tef.timeoutTransaction`          | `120000`           | Tiempo máx. de espera para respuesta del datáfono (ms)                             |
| `tef.maxRetries`                  | `3`                | Reintentos en caso de fallo                                                        |
| `tef.enablePanSending`            | `true`             | Indica que se solicita al datáfono que envíe el PAN enmascarado en la respuesta    |
| `tef.mockMode`                    | `true`             | Activado automáticamente en Mac/dev para no requerir hardware real                 |
| `tef.mockPort`                    | `"/dev/tty.mock"`  | Puerto ficticio cuando mockMode está activo                                        |
| `transactions.compra.header`      | `"31303030202030"` | Valor hex del **header de handshake** ("1000 0" en ASCII) — referencia informativa |
| `transactions.compra.requiresPan` | `true`             | Confirma que esta transacción exige el envío del PAN                               |

> **¿Por qué hay dos campos de `port`?**  
> `server.port` es el **puerto HTTP** (TCP) donde Node.js expone la API REST.  
> `serial.port` es el **puerto COM/serial** (RS-232/USB) al que está conectado físicamente el datáfono.  
> Son canales completamente distintos: uno es red, el otro es hardware.

### 3.2 `.env` — configuración por entorno/máquina

El archivo `.env` se crea **copiando `.env.example`** y se rellena según la máquina donde se ejecuta el servicio. **No se debe versionar** (ya está en `.gitignore`).

```dotenv
# Servidor HTTP
HTTP_PORT=3000          # Puerto TCP de la API HTTP
HTTP_HOST=localhost     # Host donde escucha Express

# Puerto serial del datáfono (cambia según la PC)
DATAFONO_PORT=COM3      # Windows: COM3, COM4, etc. / Linux: /dev/ttyUSB0

# Timeout para transacciones (milisegundos)
TRANSACTION_TIMEOUT=60000

# Habilitar logs detallados
DEBUG=true

# CORS — dominio de la aplicación PHP
ALLOWED_ORIGIN=http://localhost:8000

# Logs
LOG_LEVEL=info
LOG_FILE=tef-bridge.log
```

> **¿Por qué también hay un `port` en `.env`?**  
> Igual que en `config.json`, existen dos puertos separados:
>
> - `HTTP_PORT` → Puerto de la API REST (Express).
> - `DATAFONO_PORT` → Puerto serial del hardware.  
>   El `.env` permite cambiar estos valores **por máquina** sin tocar el código ni el `config.json` (que sería un cambio en el repositorio).

### 3.3 Lógica de precedencia

```
index.js arranca
    │
    ├─ dotenv.config()  →  carga .env
    │
    └─ JSON.parse(config.json)  →  carga config.json como base

En runtime el código usa config.serial.port, config.server.port, etc.
El .env afecta el comportamiento vía process.env (NODE_ENV, DEBUG, etc.)
Si NODE_ENV=development o la plataforma es macOS → config.tef.mockMode = true
```

---

## 4. Protocolo TEF II — Conceptos clave

El protocolo TEF II de Credibanco define el formato exacto de los mensajes binarios que se intercambian entre el computador y el datáfono a través del puerto serial RS-232.

### 4.1 Caracteres de control

| Nombre | Hex    | Decimal | Función                                      |
| ------ | ------ | ------- | -------------------------------------------- |
| `STX`  | `0x02` | 2       | Inicio de trama (Start of Text)              |
| `ETX`  | `0x03` | 3       | Fin de trama (End of Text)                   |
| `SEP`  | `0x1C` | 28      | Separador de campos dentro de la trama       |
| `ACK`  | `0x06` | 6       | Confirmación de trama recibida correctamente |
| `NACK` | `0x15` | 21      | Trama rechazada (error)                      |

### 4.2 Estructura general de una trama

```
┌─────────────────────────────────────────────────────────────────┐
│  STX │ LENGTH (2 bytes BCD) │ MENSAJE │ LRC                     │
└─────────────────────────────────────────────────────────────────┘
```

Donde `MENSAJE` se compone de:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ TRANSPORT HEADER (10 bytes) │ PRESENTATION HEADER (7 bytes) │ CAMPOS DE DATOS │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Componente              | Tamaño      | Descripción                                                     |
| ----------------------- | ----------- | --------------------------------------------------------------- |
| `STX`                   | 1 byte      | Marca el inicio                                                 |
| `LENGTH`                | 2 bytes BCD | Longitud del mensaje (sin STX, sin ETX, sin LRC)                |
| **Transport Header**    | 10 bytes    | Identificador de red/transporte: `"6000000000"` en ASCII (fijo) |
| **Presentation Header** | 7 bytes     | Identifica el tipo de transacción                               |
| Campos (`SEP + CAMPO`)  | variable    | Datos de la transacción separados por `0x1C`                    |
| `ETX`                   | 1 byte      | Marca el fin del mensaje                                        |
| `LRC`                   | 1 byte      | Checksum XOR de integridad                                      |

### 4.3 Los dos headers fijos

**Transport Header** — Fijo en todas las tramas:

```
Hex:   36 30 30 30 30 30 30 30 30 30
ASCII: 6  0  0  0  0  0  0  0  0  0   →   "6000000000"
```

**Presentation Header** — Identifica la transacción. Para **Compra con PAN**:

```
Hex:   31 30 30 30 30 30 30
ASCII: 1  0  0  0  0  0  0   →   "1000000"
```

Para el **Handshake inicial** (distinto: tiene espacios en posición 5 y 6):

```
Hex:   31 30 30 30 20 20 30
ASCII: 1  0  0  0     (sp)(sp) 0   →   "1000  0"
```

> La diferencia entre `"1000000"` (compra) y `"1000  0"` (handshake) es que las posiciones 5 y 6 son **espacios ASCII (0x20)** en el handshake y **ceros ASCII (0x30)** en la compra.

---

## 5. Construcción de tramas (frames) para Compra con PAN

El flujo de una compra requiere **dos tramas** en secuencia:

```
PC ──[HANDSHAKE FRAME]──► Datáfono
PC ◄──[ACK]────────────── Datáfono
PC ──[PURCHASE FRAME]──► Datáfono
PC ◄──[Respuesta final]── Datáfono
PC ──[ACK]──────────────► Datáfono
```

### 5.1 Trama de Handshake

Es una **trama corta** sin campos de datos. Solo contiene los dos headers. Su función es iniciar el diálogo con el datáfono antes de enviar los datos reales de la compra.

**Construcción paso a paso** (`TEFProtocol.buildHandshakeFrame()`):

```
PASO 1 — Cuerpo del mensaje (sin ETX):
  MessageBody = TRANSPORT_HEADER + PRESENTATION_HEADER(HANDSHAKE)
              = "6000000000" + "1000  0"
              = 10 + 7 = 17 bytes

PASO 2 — Calcular LENGTH (BCD):
  17 en decimal → "0017" → Buffer [0x00, 0x17]

PASO 3 — Agregar ETX al mensaje:
  message = MessageBody + ETX (0x03)

PASO 4 — Calcular LRC:
  LRC = XOR de todos los bytes en (LENGTH + message)
      = XOR([0x00, 0x17] + MessageBody + [0x03])

PASO 5 — Trama completa:
  Frame = STX + LENGTH + message + LRC
        = [0x02] [0x00 0x17] [17 bytes de headers] [0x03] [1 byte LRC]
  Total = 22 bytes
```

**Diagrama visual:**

```
Byte:   1    │  2   3  │  4..13             │  14..20            │  21  │  22
        ─────┼─────────┼────────────────────┼────────────────────┼──────┼────
        STX  │ LENGTH  │ Transport Header   │ Presentation Header│  ETX │ LRC
        0x02 │ 00  17  │ "6000000000"       │ "1000  0"          │ 0x03 │ XOR
```

### 5.2 Trama de Compra con PAN

Es la trama principal de la transacción. Lleva los datos de la venta en **8 campos** separados por `0x1C`.

**Presentation Header usado:**

```
Hex:   31 30 30 30 30 30 30   →   ASCII: "1000000"
```

El campo `sendPan = true` indica que el datáfono debe retornar el PAN enmascarado en su respuesta, pero **no cambia el valor del header binario** en esta implementación (ambos `COMPRA` y `COMPRA_CON_PAN` usan `"1000000"`). La diferencia la controla el descriptor del campo de respuesta del datáfono.

**Campos enviados** (en orden estricto):

| #   | Campo                 | Tipo ASCII | Longitud (bytes) | Contenido                                           |
| --- | --------------------- | ---------- | ---------------- | --------------------------------------------------- |
| 1   | Valor total compra    | `"40"`     | 12               | Monto en centavos, relleno con ceros a la izquierda |
| 2   | Valor IVA             | `"41"`     | 12               | IVA en centavos, relleno con ceros                  |
| 3   | Número de caja        | `"42"`     | 10               | ID terminal, relleno con espacios a la derecha      |
| 4   | Número de transacción | `"53"`     | 10               | ID transacción único, relleno con espacios          |
| 5   | Propina / Cash Back   | `"81"`     | 12               | Propina en centavos, relleno con ceros              |
| 6   | Valor IAC             | `"82"`     | 12               | Valor IAC en centavos, relleno con ceros            |
| 7   | Identificación cajero | `"83"`     | 12               | ID cajero, relleno con espacios a la derecha        |
| 8   | Filler                | `"84"`     | 12               | Siempre `"000000000000"` (reservado)                |

**Construcción paso a paso** (`TEFProtocol.buildPurchaseFrame()`):

```
PASO 1 — Formatear valores de entrada:
  amount  →  String de 12 chars relleno con ceros a la izquierda
             Ej: 50000 centavos = "000000050000"
  tax     →  Ídem para el IVA
  terminalId → 10 chars relleno con espacios a la derecha: "001       "
  transactionId → 10 chars relleno con espacios: "T123456789"
  cashierId → 12 chars relleno con espacios: "OSCROM      "
  tip, iac → 12 chars, ceros

PASO 2 — Construir cada campo con buildField(tipo, valor, longitud):
  [tipo(2 bytes ASCII)] + [longitud del valor(2 bytes hex)] + [valor(n bytes ASCII)]
  Ej. Campo 40 con monto 50000:
    "40" + 0x00 0x0C ("000c" hex = 12) + "000000050000"
    = bytes: 34 30 | 00 0C | 30 30 30 30 30 30 30 35 30 30 30 30

PASO 3 — Construir el cuerpo del mensaje (sin ETX):
  MessageBody = TRANSPORT_HEADER
              + PRESENTATION_HEADER("1000000")
              + (SEP + Campo40)
              + (SEP + Campo41)
              + (SEP + Campo42)
              + (SEP + Campo53)
              + (SEP + Campo81)
              + (SEP + Campo82)
              + (SEP + Campo83)
              + (SEP + Campo84)

PASO 4 — Calcular LENGTH (BCD) del MessageBody (sin ETX):
  Ejemplo de tamaño:
    Transport(10) + Presentation(7) = 17
    + 8 campos × (SEP=1 + TYPE=2 + LEN=2) = 8 × 5 = 40
    + valores: 12+12+10+10+12+12+12+12 = 92
    Total = 17 + 40 + 92 = 149 bytes
  149 decimal → "0149" → Buffer [0x01, 0x49]

PASO 5 — Agregar ETX:
  message = MessageBody + ETX(0x03)

PASO 6 — Calcular LRC:
  LRC = XOR de todos los bytes en (LENGTH + message)

PASO 7 — Trama final:
  Frame = STX + LENGTH + message + LRC
```

**Diagrama visual simplificado:**

```
[STX] [LENGTH 2B] [Transport 10B] [Presentation 7B]
  [1C][40][000C][monto 12B]
  [1C][41][000C][iva 12B]
  [1C][42][000A][terminal 10B]
  [1C][53][000A][txId 10B]
  [1C][81][000C][propina 12B]
  [1C][82][000C][iac 12B]
  [1C][83][000C][cajero 12B]
  [1C][84][000C][000000000000 12B]
[ETX] [LRC]
```

### 5.3 Cálculo de LENGTH (BCD)

El campo `LENGTH` es de **2 bytes** y codifica en **BCD** (Binary Coded Decimal) la cantidad de bytes del mensaje entre `LENGTH` y `ETX` (sin incluir `STX`, `LENGTH` mismo, `ETX` ni `LRC`):

```javascript
static buildLength(messageLength) {
  const lengthStr = messageLength.toString(10).padStart(4, "0"); // ej: "0149"
  return Buffer.from(lengthStr, "hex");                          // [0x01, 0x49]
}
```

| Longitud decimal | String 4 chars | Bytes resultantes |
| ---------------- | -------------- | ----------------- |
| 17               | `"0017"`       | `[0x00, 0x17]`    |
| 149              | `"0149"`       | `[0x01, 0x49]`    |

> En BCD, cada cifra decimal ocupa 4 bits. Así, el número decimal `149` queda codificado como `0x01 0x49` (no como `0x95` que sería binario puro).

### 5.4 Cálculo de LRC

El **LRC** (Longitudinal Redundancy Check) es una operación **XOR** de todos los bytes desde `LENGTH` hasta `ETX` (ambos inclusive):

```javascript
static calculateLRC(buffer) {
  let lrc = 0;
  for (const byte of buffer) {
    lrc ^= byte;   // XOR acumulativo
  }
  return Buffer.from([lrc]);
}
```

El buffer sobre el que se calcula el LRC es: `[LENGTH bytes] + [Transport Header] + [Presentation Header] + [campos con separadores] + [ETX]`.

El datáfono realiza la misma operación al recibir y verifica que su XOR coincida con el byte `LRC` al final de la trama. Si falla, responde con `NACK`.

### 5.5 Formato de cada Campo de datos

Cada campo sigue siempre la misma estructura de **4 bytes de cabecera + N bytes de valor**:

```
┌──────────────┬───────────────────┬────────────────┐
│  TIPO (2B)   │  LONGITUD (2B)    │  VALOR (N B)   │
│  ASCII dec   │  hex del tamaño   │  ASCII         │
└──────────────┴───────────────────┴────────────────┘
```

**Ejemplo campo 40 (monto $500.00 = 50000 centavos):**

```
Tipo "40":      ASCII → bytes: 0x34 0x30
Longitud 12:    hex "000c" → bytes: 0x00 0x0C
Valor:          "000000050000" → 12 bytes ASCII

Resultado: 34 30 00 0C 30 30 30 30 30 30 30 35 30 30 30 30
```

**Reglas de relleno:**

- Campos numéricos (montos): relleno con `'0'` (0x30) a la **izquierda**
- Campos alfanuméricos (IDs): relleno con espacios `' '` (0x20) a la **derecha**
- Si el valor supera la longitud definida, se **trunca**

---

## 6. Flujo completo de una compra

```
App PHP                    tef-bridge (Node.js)              Datáfono
   │                              │                              │
   │── POST /api/purchase ───────►│                              │
   │   { amount, tax, ... }       │                              │
   │                              │ Validar con Joi              │
   │                              │ Generar transactionId si     │
   │                              │  no viene en la petición     │
   │                              │                              │
   │                              │──── Handshake Frame ────────►│
   │                              │     (22 bytes aprox.)        │
   │                              │◄─── ACK (0x06) ─────────────│
   │                              │  (espera hasta 30 segundos)  │
   │                              │                              │
   │                              │──── Purchase Frame ─────────►│
   │                              │     (~170 bytes aprox.)      │
   │                              │   El usuario interactúa      │
   │                              │   con el datáfono...         │
   │                              │◄─── Respuesta + LRC ────────│
   │                              │  (espera hasta 120 segundos) │
   │                              │──── ACK (0x06) ────────────►│
   │                              │                              │
   │                              │ Parsear respuesta            │
   │                              │ Validar campo 3438 == "00"   │
   │◄── JSON respuesta ───────────│                              │
   │   { status, data: {...} }    │                              │
```

### Generación del `transactionId`

Si la aplicación PHP no envía un `transactionId`, el servicio genera uno automáticamente:

```javascript
const transactionId =
  value.transactionId || `T${Date.now().toString().slice(-9)}`;
// Ejemplo: "T123456789" (letra T + últimos 9 dígitos del timestamp Unix)
```

---

## 7. Parseo de la respuesta

La respuesta del datáfono sigue la misma estructura de trama (STX + LENGTH + headers + campos + ETX + LRC). Los campos en la respuesta también tienen formato `[TIPO 2B][LONGITUD 2B][VALOR]` separados por `0x1C`.

### 7.1 Validación de integridad

`SerialManager.processResponseBuffer()` busca un STX, luego el ETX correspondiente. Una vez que tiene la trama completa, invoca `TEFProtocol.validateFrame()` que recalcula el LRC y lo compara con el byte final recibido. Si coincide, envía un `ACK` al datáfono.

### 7.2 Regla de aprobación

Una transacción se considera **aprobada únicamente** si el campo con tipo `3438` (ASCII "48" que corresponde al código de respuesta) tiene el valor ASCII `"00"`:

```javascript
const responseCode = result?.fields?.["3438"]?.ascii;
const isApproved = responseCode === "00";
```

> `3438` es la representación hex ASCII de los bytes que forman el string `"48"` (el tipo del campo de código de respuesta según el protocolo TEF II).

### 7.3 Campos relevantes de la respuesta

| Clave en `fields` | Tipo hex→ASCII | Contenido                                   |
| ----------------- | -------------- | ------------------------------------------- |
| `"3430"`          | `"40"`         | Monto aprobado                              |
| `"3435"`          | `"45"`         | Código de autorización del banco            |
| `"3436"`          | `"46"`         | Fecha de transacción (AAAAMMDD)             |
| `"3437"`          | `"47"`         | Hora de transacción (HHMM)                  |
| `"3438"`          | `"48"`         | **Código de respuesta** (`"00"` = aprobado) |
| `"3439"`          | `"49"`         | Franquicia (VISA, MC, AMEX, etc.)           |
| `"3530"`          | `"P0"`         | Tipo de cuenta (CR=Crédito, DB=Débito)      |
| `"3531"`          | `"Q1"`         | Número de cuotas                            |
| `"3534"`          | `"T4"`         | Últimos 4 dígitos de la tarjeta             |

---

## 8. Endpoints HTTP disponibles

| Método | Ruta            | Descripción                                     |
| ------ | --------------- | ----------------------------------------------- |
| `GET`  | `/api/health`   | Estado del servicio y del puerto serial         |
| `GET`  | `/api/status`   | Detalles de conexión, uptime, memoria           |
| `GET`  | `/api/ports`    | Lista los puertos seriales disponibles en la PC |
| `POST` | `/api/connect`  | Conecta a un puerto serial específico           |
| `POST` | `/api/purchase` | **Inicia una transacción de compra**            |
| `POST` | `/api/reversal` | Anulación (pendiente de implementar)            |

### POST `/api/purchase` — Parámetros

| Campo           | Tipo       | Requerido | Default    | Descripción                                         |
| --------------- | ---------- | --------- | ---------- | --------------------------------------------------- |
| `amount`        | integer    | ✅ Sí     | —          | Monto en **centavos** (ej: `150000` = $1,500.00)    |
| `tax`           | integer    | No        | `0`        | IVA en centavos                                     |
| `terminalId`    | string(10) | No        | `"001"`    | Número de caja/terminal                             |
| `transactionId` | string(10) | No        | auto       | ID único de transacción (se genera si no se envía)  |
| `cashierId`     | string(12) | No        | `"OSCROM"` | Identificador del cajero                            |
| `tip`           | integer    | No        | `0`        | Propina en centavos                                 |
| `iac`           | integer    | No        | `0`        | Valor IAC                                           |
| `sendPan`       | boolean    | No        | `true`     | Si `true`, solicita PAN enmascarado en la respuesta |

### Ejemplo de respuesta aprobada

```json
{
  "status": "approved",
  "message": "Transacción aprobada",
  "data": {
    "success": true,
    "authCode": "123456",
    "responseCode": "00",
    "amount": "000000150000",
    "transactionId": "T987654321",
    "terminalId": "001",
    "cashierId": "OSCROM",
    "date": "20260226",
    "time": "1430",
    "franchise": "VISA",
    "accountType": "CR",
    "last4": "4321",
    "quotas": "01"
  }
}
```

---

## 9. Comunicación serial (`SerialManager`)

### Parámetros de conexión

| Parámetro | Valor  | Descripción                                                         |
| --------- | ------ | ------------------------------------------------------------------- |
| Baud Rate | `9600` | Velocidad de comunicación (configurada en `config.serial.baudRate`) |
| Data Bits | `8`    | Bits de datos por carácter                                          |
| Stop Bits | `1`    | Bits de parada                                                      |
| Parity    | `none` | Sin paridad                                                         |

### Detección automática de plataforma

Al arrancar, si el sistema operativo es **macOS** o `NODE_ENV` es `development`/`mock`, el servicio activa automáticamente el **modo mock** (`config.tef.mockMode = true`) para no requerir hardware físico.

En Linux/Windows con un puerto COM real, busca el puerto definido en `config.serial.port`. Si está en macOS y el puerto configurado es `"COM3"` (Windows), intenta automáticamente puertos comunes de Mac:

```
/dev/tty.usbserial
/dev/ttyUSB0
/dev/ttyACM0
/dev/ttyS0
```

### Buffer de respuesta

Los datos del datáfono pueden llegar en **múltiples fragmentos** por el puerto serial. `SerialManager` los acumula en `responseBuffer` y solo procesa la trama cuando detecta tanto un `STX` como un `ETX` en el buffer acumulado.

---

## 10. Códigos de respuesta del datáfono

| Código      | Significado               |
| ----------- | ------------------------- |
| `00`        | ✅ Transacción Aprobada   |
| `01` / `02` | Contactar entidad         |
| `03`        | Comercio no registrado    |
| `04` / `07` | Retener tarjeta           |
| `05`        | No honrar                 |
| `12`        | Transacción inválida      |
| `13`        | Monto inválido            |
| `14`        | Tarjeta inválida          |
| `51`        | Fondos insuficientes      |
| `54`        | Tarjeta vencida           |
| `55`        | PIN incorrecto            |
| `57` / `58` | Transacción no permitida  |
| `61` / `65` | Excede límite             |
| `91`        | Entidad no responde       |
| `96`        | Error de sistema          |
| `99`        | Problemas de comunicación |

---

## Apéndice — ¿Cómo cambiar el puerto del datáfono?

Si se conecta el datáfono a un puerto diferente:

1. Identificar el puerto:
   - Windows: Administrador de dispositivos → Puertos COM
   - Linux/Mac: `ls /dev/tty*` o usar `GET /api/ports`
2. Editar el `.env`:
   ```dotenv
   DATAFONO_PORT=COM5
   ```
   O editar `config.json` → `serial.port`.
3. Reiniciar el servicio: `npm start`
4. Verificar: `GET /api/health` debe mostrar `"connected": true`

> Si el servicio ya está corriendo, también se puede conectar a un nuevo puerto sin reiniciar usando `POST /api/connect` con `{ "port": "COM5" }`.
