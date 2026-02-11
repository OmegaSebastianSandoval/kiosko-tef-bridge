/**
 * Protocolo TEF II - Credibanco
 * Implementación completa del protocolo de comunicación con datáfonos
 */

import { logger, logHex } from "./logger.js";

export class TEFProtocol {
  // Caracteres de control
  static STX = Buffer.from("02", "hex");
  static ETX = Buffer.from("03", "hex");
  static SEPARATOR = Buffer.from("1C", "hex");
  static ACK = Buffer.from("06", "hex");
  static NACK = Buffer.from("15", "hex");

  // Headers fijos
  static TRANSPORT_HEADER = Buffer.from("363030303030303030", "hex");

  // Presentation Headers para diferentes transacciones
  static HEADERS = {
    COMPRA: Buffer.from("31303030202030", "hex"), // Compra normal
    COMPRA_CON_PAN: Buffer.from("31303030202030", "hex"), // Compra con envío PAN
    ANULACION: Buffer.from("31303032303030", "hex"), // Anulación
    CONSULTA_SALDO: Buffer.from("31303232202030", "hex"), // Consulta saldo
    AVANCE: Buffer.from("31303037202030", "hex"), // Avance efectivo
    CIERRE: Buffer.from("31303135202030", "hex"), // Cierre integrado
    COMPRA_CUPON: Buffer.from("31303235202030", "hex"), // Compra con cupón
    RECARGA_BONO: Buffer.from("3130303620303030", "hex"), // Recarga bono
  };

  /**
   * Calcula la longitud de mensaje en formato BCD de 2 bytes
   * Ejemplo: 17 bytes -> "0017" -> Buffer 00 17 (hex/BCD)
   */
  static buildLength(messageLength) {
    const lengthStr = messageLength.toString(10).padStart(4, "0");
    return Buffer.from(lengthStr, "hex");
  }

  /**
   * Calcula LRC (Longitudinal Redundancy Check)
   * XOR de todos los bytes después de STX hasta ETX inclusive
   */
  static calculateLRC(buffer) {
    let lrc = 0;
    for (const byte of buffer) {
      lrc ^= byte;
    }
    return Buffer.from([lrc]);
  }

  /**
   * Construye trama de handshake inicial (mensaje corto solo con headers)
   * Debe enviarse ANTES de la trama de compra
   */
  static buildHandshakeFrame(sendPan = true) {
    // Seleccionar header según configuración
    const presentationHeader = sendPan
      ? TEFProtocol.HEADERS.COMPRA_CON_PAN
      : TEFProtocol.HEADERS.COMPRA;

    // Construir mensaje: Transport Header + Presentation Header + ETX
    const message = Buffer.concat([
      TEFProtocol.TRANSPORT_HEADER,
      presentationHeader,
      TEFProtocol.ETX,
    ]);

    // Calcular longitud (no incluye STX, LENGTH ni LRC)
    const length = TEFProtocol.buildLength(message.length);

    // Calcular LRC (sobre LENGTH + MESSAGE)
    const messageWithLength = Buffer.concat([length, message]);
    const lrc = TEFProtocol.calculateLRC(messageWithLength);

    // Trama completa: STX + LENGTH + MESSAGE + LRC
    const completeFrame = Buffer.concat([
      TEFProtocol.STX,
      length,
      message,
      lrc,
    ]);

    logHex(completeFrame, "Trama handshake construida");
    return completeFrame;
  }

  /**
   * Construye un campo TEF con formato: [Tipo(2)][Longitud(2)][Valor]
   */
  static buildField(fieldType, value, length = null) {
    // Convertir tipo de campo a hex (ej: 40 -> 0x34 0x30)
    const typeHex = fieldType.toString(16).padStart(2, "0");
    const typeBuffer = Buffer.from(typeHex, "hex");

    // Determinar longitud
    let actualLength = length;
    let valueBuffer;

    if (Buffer.isBuffer(value)) {
      valueBuffer = value;
      if (actualLength === null) actualLength = valueBuffer.length;
    } else {
      // Convertir string a ASCII
      valueBuffer = Buffer.from(String(value), "ascii");
      if (actualLength === null) actualLength = valueBuffer.length;
    }

    // Ajustar longitud: rellenar con espacios (0x20) o truncar
    if (valueBuffer.length < actualLength) {
      const padding = Buffer.alloc(actualLength - valueBuffer.length, 0x20);
      valueBuffer = Buffer.concat([valueBuffer, padding]);
    } else if (valueBuffer.length > actualLength) {
      valueBuffer = valueBuffer.subarray(0, actualLength);
    }

    // Longitud en 2 bytes (4 caracteres hex)
    const lengthHex = actualLength.toString(16).padStart(4, "0");
    const lengthBuffer = Buffer.from(lengthHex, "hex");

    return Buffer.concat([typeBuffer, lengthBuffer, valueBuffer]);
  }

  /**
   * Construye trama completa para compra
   */
  static buildPurchaseFrame(transactionData) {
    const {
      amount, // Monto en centavos (ej: 100000 = $1,000.00)
      tax = 0, // IVA en centavos
      cashierId = "OSCROM", // ID cajero (12 caracteres)
      terminalId = "001", // Número de caja (10 caracteres)
      transactionId, // ID transacción única (10 caracteres)
      tip = 0, // Propina en centavos
      iac = 100, // Valor IAC
      sendPan = true, // Solicitar envío de PAN
    } = transactionData;

    // Validaciones
    if (!amount || !transactionId) {
      throw new Error("Monto y transactionId son requeridos");
    }

    // Formatear valores a longitud fija
    const amountStr = String(amount).padStart(12, "0");
    const taxStr = String(tax).padStart(12, "0");
    const tipStr = String(tip).padStart(12, "0");
    const iacStr = String(iac).padStart(12, "0");
    const cashierStr = cashierId.padEnd(12, " ").substring(0, 12);
    const terminalStr = terminalId.padEnd(10, " ").substring(0, 10);
    const transactionStr = transactionId.padEnd(10, " ").substring(0, 10);

    // Seleccionar header según configuración
    const presentationHeader = sendPan
      ? TEFProtocol.HEADERS.COMPRA_CON_PAN
      : TEFProtocol.HEADERS.COMPRA;

    // Construir campos en el orden correcto
    const fields = [
      // Campo 40: Valor total compra (12 caracteres)
      TEFProtocol.buildField(0x34, amountStr, 12),

      // Campo 41: Valor IVA (12 caracteres)
      TEFProtocol.buildField(0x35, taxStr, 12),

      // Campo 42: Número de caja (10 caracteres)
      TEFProtocol.buildField(0x36, terminalStr, 10),

      // Campo 53: Número de transacción (10 caracteres)
      TEFProtocol.buildField(0x37, transactionStr, 10),

      // Campo 81: Propina o Cash Back (12 caracteres)
      TEFProtocol.buildField(0x38, tipStr, 12),

      // Campo 82: Valor IAC (12 caracteres)
      TEFProtocol.buildField(0x39, iacStr, 12),

      // Campo 83: Identificación del cajero (12 caracteres)
      TEFProtocol.buildField(0x3b, cashierStr, 12),

      // Campo 84: Filler (12 caracteres, siempre 000000000000)
      TEFProtocol.buildField(0x3c, "000000000000", 12),
    ];

    // Construir mensaje sin STX
    let messageWithoutSTX = Buffer.concat([
      TEFProtocol.TRANSPORT_HEADER,
      presentationHeader,
    ]);

    // Agregar campos con separadores
    for (const field of fields) {
      messageWithoutSTX = Buffer.concat([
        messageWithoutSTX,
        TEFProtocol.SEPARATOR,
        field,
      ]);
    }

    // Agregar ETX
    messageWithoutSTX = Buffer.concat([messageWithoutSTX, TEFProtocol.ETX]);

    // Calcular longitud del mensaje (no incluye STX, LENGTH ni LRC)
    const length = TEFProtocol.buildLength(messageWithoutSTX.length);

    // Calcular LRC (sobre LENGTH + MESSAGE)
    const messageWithLength = Buffer.concat([length, messageWithoutSTX]);
    const lrc = TEFProtocol.calculateLRC(messageWithLength);

    // Trama completa: STX + LENGTH + MESSAGE + LRC
    const completeFrame = Buffer.concat([
      TEFProtocol.STX,
      length,
      messageWithoutSTX,
      lrc,
    ]);

    logHex(completeFrame, "Trama compra construida");
    return completeFrame;
  }

  /**
   * Parsea respuesta del datáfono
   */
  static parseResponse(responseBuffer) {
    if (!responseBuffer || responseBuffer.length === 0) {
      return { error: "Respuesta vacía" };
    }

    const result = {
      raw: responseBuffer.toString("hex").toUpperCase(),
      fields: {},
      success: false,
      message: "",
    };

    try {
      // Buscar campos en la respuesta
      let position = 0;

      // Buscar separadores 0x1C
      while (position < responseBuffer.length) {
        if (responseBuffer[position] === 0x1c) {
          position++;

          // Leer tipo de campo (2 bytes)
          if (position + 2 <= responseBuffer.length) {
            const fieldType = responseBuffer.subarray(position, position + 2);
            position += 2;

            // Leer longitud (2 bytes)
            if (position + 2 <= responseBuffer.length) {
              const lengthBytes = responseBuffer.subarray(
                position,
                position + 2,
              );
              const length = parseInt(lengthBytes.toString("hex"), 16);
              position += 2;

              // Leer valor
              if (position + length <= responseBuffer.length) {
                const value = responseBuffer.subarray(
                  position,
                  position + length,
                );
                position += length;

                // Mapear campo por tipo
                const fieldTypeHex = fieldType.toString("hex").toUpperCase();
                result.fields[fieldTypeHex] = {
                  raw: value.toString("hex").toUpperCase(),
                  ascii: value.toString("ascii").trim(),
                  length,
                };

                // Campos importantes
                if (fieldTypeHex === "34")
                  result.amount = value.toString("ascii").trim();
                if (fieldTypeHex === "48")
                  result.responseCode = value.toString("ascii").trim();
                if (fieldTypeHex === "31")
                  result.authCode = value.toString("ascii").trim();
                if (fieldTypeHex === "35")
                  result.tax = value.toString("ascii").trim();
                if (fieldTypeHex === "3F")
                  result.franchise = value.toString("ascii").trim();
                if (fieldTypeHex === "32")
                  result.accountType = value.toString("ascii").trim();
                if (fieldTypeHex === "36")
                  result.last4 = value.toString("ascii").trim();
              }
            }
          }
        } else {
          position++;
        }
      }

      // Determinar éxito
      if (result.fields["48"] && result.fields["48"].ascii === "00") {
        result.success = true;
        result.message = "Transacción aprobada";
      } else if (result.fields["48"]) {
        result.success = false;
        const code = result.fields["48"].ascii;
        result.message = this.getResponseMessage(code);
      }
    } catch (error) {
      result.error = error.message;
      logger.error(`Error parseando respuesta: ${error.message}`);
    }

    return result;
  }

  /**
   * Obtiene mensaje descriptivo para códigos de respuesta
   */
  static getResponseMessage(code) {
    const messages = {
      "00": "Transacción Aprobada",
      "01": "Contactar entidad",
      "02": "Contactar entidad",
      "03": "Comercio no registrado",
      "04": "Retener tarjeta",
      "05": "No honrar",
      "06": "Error",
      "07": "Retener tarjeta",
      12: "Transacción inválida",
      13: "Monto inválido",
      14: "Tarjeta inválida",
      15: "Entidad no válida",
      19: "Reintentar",
      30: "Error de formato",
      41: "Tarjeta perdida",
      43: "Tarjeta robada",
      51: "Fondos insuficientes",
      54: "Tarjeta vencida",
      55: "PIN incorrecto",
      57: "Transacción no permitida",
      58: "Transacción no permitida",
      59: "Sospecha de fraude",
      61: "Excede límite",
      62: "Tarjeta restringida",
      63: "Violación de seguridad",
      65: "Excede límite",
      75: "Excede intentos PIN",
      76: "No se encuentra original",
      77: "No coincide monto",
      78: "Cuenta no existe",
      85: "No hay razón para declinar",
      91: "Entidad no responde",
      92: "Destino no encontrado",
      93: "Transacción no puede completarse",
      94: "Duplicada",
      96: "Error sistema",
      99: "Problemas de comunicación",
    };

    return messages[code] || `Código desconocido: ${code}`;
  }

  /**
   * Valida una trama recibida (LRC y estructura)
   */
  static validateFrame(frame) {
    if (!frame || frame.length < 5) {
      return { valid: false, error: "Trama demasiado corta" };
    }

    // Verificar STX
    if (frame[0] !== 0x02) {
      return { valid: false, error: "STX no encontrado" };
    }

    // Verificar ETX
    const etxIndex = frame.indexOf(0x03);
    if (etxIndex === -1) {
      return { valid: false, error: "ETX no encontrado" };
    }

    // Calcular LRC esperado
    const messageWithoutSTX = frame.subarray(1, etxIndex + 1);
    const expectedLRC = this.calculateLRC(messageWithoutSTX)[0];

    // LRC recibido (último byte)
    const receivedLRC = frame[frame.length - 1];

    if (expectedLRC !== receivedLRC) {
      return {
        valid: false,
        error: `LRC inválido. Esperado: ${expectedLRC.toString(16)}, Recibido: ${receivedLRC.toString(16)}`,
      };
    }

    return { valid: true };
  }
}
