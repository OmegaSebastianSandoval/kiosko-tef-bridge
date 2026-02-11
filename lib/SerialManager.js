/**
 * Gestor de comunicación serial con datáfono
 */

import { SerialPort } from "serialport";
import { logger, logHex } from "./logger.js";
import { TEFProtocol } from "./TEFProtocol.js";

export class SerialManager {
  constructor(config) {
    this.config = config;
    this.port = null;
    this.isConnected = false;
  
    this.pendingResolves = new Map();
    this.responseBuffer = Buffer.alloc(0);

    
  }

  /**
   * Conecta al puerto serial
   */
  async connect() {
    try {


      logger.info(`Conectando a ${this.config.port}...`);

      // En Mac/Linux, intentar puertos comunes si COM3 falla
      let portPath = this.config.port;
      if (process.platform !== "win32" && portPath === "COM3") {
        // Puerto comunes en Mac
        const macPorts = [
          "/dev/tty.usbserial",
          "/dev/ttyUSB0",
          "/dev/ttyACM0",
          "/dev/ttyS0",
        ];

        // Verificar puertos disponibles
        const ports = await SerialPort.list();
        const availablePorts = ports.map((p) => p.path);
        logger.info(`Puertos disponibles: ${availablePorts.join(", ")}`);

        // Buscar un puerto válido
        const validPort = macPorts.find((port) =>
          availablePorts.includes(port),
        );
        if (validPort) {
          portPath = validPort;
          logger.info(`Usando puerto: ${portPath}`);
        } else {
          return;
        }
      }

      this.port = new SerialPort({
        path: portPath,
        baudRate: this.config.baudRate || 9600,
        dataBits: this.config.dataBits || 8,
        stopBits: this.config.stopBits || 1,
        parity: this.config.parity || "none",
        autoOpen: false,
      });

      return new Promise((resolve, reject) => {
        this.port.open((error) => {
          if (error) {
            logger.error(`Error abriendo puerto: ${error.message}`);
            resolve();
            return;
          }

          logger.info(
            `Conectado a ${portPath} a ${this.config.baudRate} bauds`,
          );
          this.isConnected = true;

          // Configurar manejadores de eventos
          this.port.on("data", (data) => this.handleData(data));
          this.port.on("error", (error) => this.handleError(error));
          this.port.on("close", () => this.handleClose());

          resolve();
        });
      });
    } catch (error) {
      logger.error(`Error en conexión: ${error.message}`);

    }
  }

  /**
   * Desconecta del puerto serial
   */
  async disconnect() {
    return new Promise((resolve) => {
      if (!this.port || !this.isConnected) {
        resolve();
        return;
      }

      this.port.close((error) => {
        if (error) {
          logger.error(`Error cerrando puerto: ${error.message}`);
        } else {
          logger.info("Puerto serial cerrado");
          this.isConnected = false;
        }
        resolve();
      });
    });
  }

  /**
   * Envía trama al datáfono y espera respuesta
   */
  async sendAndReceive(frame, timeout = 60000) {
    if (!this.isConnected) {
      throw new Error("No conectado al datáfono");
    }



    return new Promise((resolve, reject) => {
      const transactionId = Date.now().toString();
      let timeoutId;

      // Configurar timeout
      timeoutId = setTimeout(() => {
        this.pendingResolves.delete(transactionId);
        reject(new Error("Timeout esperando respuesta del datáfono"));
      }, timeout);

      // Guardar resolver para usar cuando llegue la respuesta
      this.pendingResolves.set(transactionId, { resolve, reject, timeoutId });

      // Enviar trama
      this.sendFrame(frame);
    });
  }

 
  /**
   * Envía una trama al datáfono
   */
  sendFrame(frame) {
  

    logHex(frame, "Enviando trama");

    this.port.write(frame, (error) => {
      if (error) {
        logger.error(`Error enviando trama: ${error.message}`);
      } else {
        logger.debug("Trama enviada exitosamente");
        this.port.drain(); // Esperar a que se termine de enviar
      }
    });
  }

  /**
   * Envía ACK de confirmación al datáfono
   */
  sendAck() {
  

    const ack = Buffer.from([0x06]);
    logHex(ack, "Enviando ACK");

    this.port.write(ack, (error) => {
      if (error) {
        logger.error(`Error enviando ACK: ${error.message}`);
      } else {
        logger.debug("ACK enviado exitosamente");
      }
    });
  }

  /**
   * Maneja datos recibidos del datáfono
   */
  handleData(data) {
    logHex(data, "Datos recibidos");

    // Agregar al buffer
    this.responseBuffer = Buffer.concat([this.responseBuffer, data]);

    // Procesar ACKs inmediatos
    if (this.responseBuffer.length === 1 && this.responseBuffer[0] === 0x06) {
      logger.debug("ACK recibido");
      this.responseBuffer = Buffer.alloc(0);
      return;
    }

    // Intentar procesar como trama completa
    this.processResponseBuffer();
  }

  /**
   * Procesa el buffer de respuesta buscando tramas completas
   */
  processResponseBuffer() {
    // Buscar STX
    const stxIndex = this.responseBuffer.indexOf(0x02);
    if (stxIndex === -1) {
      // No hay STX, descartar
      this.responseBuffer = Buffer.alloc(0);
      return;
    }

    // Buscar ETX después del STX
    const etxIndex = this.responseBuffer.indexOf(0x03, stxIndex);
    if (etxIndex === -1) {
      // ETX no encontrado, esperar más datos
      return;
    }

    // Trama completa (STX a LRC inclusive)
    const frameLength = etxIndex + 2; // ETX + LRC
    if (this.responseBuffer.length < frameLength) {
      // No tenemos toda la trama aún
      return;
    }

    const completeFrame = this.responseBuffer.subarray(stxIndex, frameLength);

    // Validar trama
    const validation = TEFProtocol.validateFrame(completeFrame);
    if (validation.valid) {
      logger.info("Trama válida recibida");

      // Enviar ACK de confirmación
      this.sendAck();

      // Parsear respuesta
      const parsedResponse = TEFProtocol.parseResponse(completeFrame);

      // Resolver promesa pendiente
      this.resolvePending(parsedResponse);
    } else {
      logger.warn(`Trama inválida: ${validation.error}`);
    }

    // Limpiar buffer procesado
    this.responseBuffer = this.responseBuffer.subarray(frameLength);

    // Si queda algo en el buffer, procesarlo
    if (this.responseBuffer.length > 0) {
      this.processResponseBuffer();
    }
  }

  /**
   * Resuelve promesa pendiente con la respuesta
   */
  resolvePending(response) {
    if (this.pendingResolves.size === 0) return;

    // Tomar la primera promesa pendiente (asumimos una transacción a la vez)
    const [id, { resolve, reject, timeoutId }] = this.pendingResolves
      .entries()
      .next().value;

    clearTimeout(timeoutId);
    this.pendingResolves.delete(id);

    if (response.error) {
      reject(new Error(response.error));
    } else {
      resolve(response);
    }
  }

  /**
   * Maneja errores del puerto serial
   */
  handleError(error) {
    logger.error(`Error en puerto serial: ${error.message}`);
    this.isConnected = false;

    // Rechazar todas las promesas pendientes
    for (const { reject } of this.pendingResolves.values()) {
      reject(new Error(`Error serial: ${error.message}`));
    }
    this.pendingResolves.clear();
  }

  /**
   * Maneja cierre del puerto
   */
  handleClose() {
    logger.info("Puerto serial cerrado");
    this.isConnected = false;
    this.responseBuffer = Buffer.alloc(0);

    // Rechazar todas las promesas pendientes
    for (const { reject } of this.pendingResolves.values()) {
      reject(new Error("Puerto serial cerrado"));
    }
    this.pendingResolves.clear();
  }

  /**
   * Verifica estado de conexión
   */
  getStatus() {
    return {
      connected: this.isConnected,
 
      port: this.config.port,
      baudRate: this.config.baudRate,
      platform: process.platform,
    };
  }
}
