/**
 * Endpoints HTTP para integración con aplicación web
 */

import { Router } from "express";
import Joi from "joi";
import { logger } from "../lib/logger.js";
import { SerialPort } from "serialport";

export function createApiRouter(serialManager, tefProtocol) {
  const router = Router();

  // Esquemas de validación
  const purchaseSchema = Joi.object({
    amount: Joi.number()
      .integer()
      .positive()
      .required()
      .description("Monto en centavos (ej: 100000 = $1,000.00)"),
    tax: Joi.number()
      .integer()
      .min(0)
      .optional()
      .description("IVA en centavos"),
    terminalId: Joi.string()
      .max(10)
      .optional()
      .default("001")
      .description("Número de caja/terminal"),
    transactionId: Joi.string()
      .max(10)
      .optional()
      .description("ID único de transacción (se genera si no se envía)"),
    cashierId: Joi.string()
      .max(12)
      .optional()
      .default("OSCROM")
      .description("ID del cajero"),
    tip: Joi.number()
      .integer()
      .min(0)
      .optional()
      .description("Propina en centavos"),
    iac: Joi.number()
      .integer()
      .min(0)
      .optional()
      .default(100)
      .description("Valor IAC"),
    sendPan: Joi.boolean()
      .optional()
      .default(true)
      .description("Solicitar envío de PAN enmascarado"),
  });

  const reversalSchema = Joi.object({
    receiptNumber: Joi.string()
      .length(6)
      .required()
      .description("Número de recibo de la transacción original"),
    terminalId: Joi.string().max(10).optional().default("001"),
    transactionId: Joi.string().max(10).optional(),
    cashierId: Joi.string().max(12).optional().default("OSCROM"),
  });

  const connectSchema = Joi.object({
    port: Joi.string()
      .required()
      .description("Puerto serial a conectar (ej: COM3)"),
  });

  /**
   * @api {get} /ports Lista puertos seriales disponibles
   * @apiName ListPorts
   * @apiGroup Serial
   */
  router.get("/ports", async (req, res) => {
    try {
      const ports = await SerialPort.list();
      res.json({
        success: true,
        ports: ports.map((port) => ({
          path: port.path,
          manufacturer: port.manufacturer,
          productId: port.productId,
          vendorId: port.vendorId,
        })),
      });
    } catch (error) {
      logger.error("Error listando puertos:", error.message);
      res.status(500).json({
        success: false,
        message: "Error listando puertos seriales",
      });
    }
  });

  /**
   * @api {post} /connect Establece conexión con datáfono
   * @apiName Connect
   * @apiGroup Serial
   */
  router.post("/connect", async (req, res) => {
    try {
      const { error, value } = connectSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          message: error.details[0].message,
        });
      }

      logger.info("Solicitud de conexión a puerto:", value.port);

      // Actualizar configuración con el puerto seleccionado
      serialManager.config.serial.port = value.port;

      // Intentar conectar
      await serialManager.connect();

      res.json({
        success: true,
        message: "Conectado al datáfono exitosamente",
        port: value.port,
      });
    } catch (error) {
      logger.error("Error en conexión:", error.message);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  });

  /**
   * @api {get} /health Verificar salud del servicio
   * @apiName HealthCheck
   * @apiGroup General
   */
  router.get("/health", (req, res) => {
    const status = serialManager.getStatus();
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "tef-bridge",
      version: "1.0.0",
      serial: status,
    });
  });

  /**
   * @api {post} /purchase Iniciar transacción de compra
   * @apiName Purchase
   * @apiGroup Transactions
   *
   * @apiBody {Number} amount Monto en centavos (ej: 100000)
   * @apiBody {Number} [tax=0] IVA en centavos
   * @apiBody {String} [terminalId="001"] Número de caja
   * @apiBody {String} [transactionId] ID único de transacción
   * @apiBody {String} [cashierId="OSCROM"] ID del cajero
   * @apiBody {Number} [tip=0] Propina en centavos
   * @apiBody {Number} [iac=100] Valor IAC
   * @apiBody {Boolean} [sendPan=true] Solicitar envío de PAN
   *
   * @apiSuccess {String} status "ok" o "error"
   * @apiSuccess {String} message Descripción del resultado
   * @apiSuccess {Object} data Datos de la transacción
   * @apiSuccess {Boolean} data.success Indica si fue aprobada
   * @apiSuccess {String} data.authCode Código de autorización
   * @apiSuccess {String} data.responseCode Código de respuesta (00=aprobado)
   * @apiSuccess {String} data.amount Monto autorizado
   * @apiSuccess {String} [data.maskedPan] PAN enmascarado (si aplica)
   * @apiSuccess {String} [data.franchise] Franquicia (VISA, MC, etc.)
   * @apiSuccess {String} [data.accountType] Tipo de cuenta (CR=Crédito, DB=Débito)
   * @apiSuccess {String} [data.last4] Últimos 4 dígitos de tarjeta
   * @apiSuccess {String} data.receiptNumber Número de recibo
   * @apiSuccess {String} data.transactionDate Fecha de transacción (AAAAMMDD)
   * @apiSuccess {String} data.transactionTime Hora de transacción (HHMM)
   */
  router.post("/purchase", async (req, res) => {
    try {
      // Validar entrada
      const { error, value } = purchaseSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: "error",
          message: error.details[0].message,
        });
      }
      console.dir(value);
      logger.warn("Procesando compra", {
        amount: value.amount,
        terminalId: value.terminalId,
        cashierId: value.cashierId,
      });

      logger.warn("Solicitud de compra recibida", value);

      // Generar transactionId si no se proporciona
      const transactionId =
        value.transactionId || `T${Date.now().toString().slice(-9)}`;

      // Construir trama TEF
      const frame = tefProtocol.buildPurchaseFrame({
        ...value,
        transactionId,
      });

      // Enviar al datáfono y esperar respuesta
      const response = await serialManager.sendAndReceive(frame);

      // Formatear respuesta para la web
      const webResponse = {
        status: "ok",
        message: response.message,
        data: {
          success: response.success,
          authCode: response.authCode,
          responseCode: response.responseCode,
          amount: response.amount,
          transactionId,
          terminalId: value.terminalId,
          cashierId: value.cashierId,
        },
      };

      // Agregar campos adicionales si existen
      if (response.fields["3F"]) {
        webResponse.data.franchise = response.fields["3F"].ascii;
      }
      if (response.fields["32"]) {
        webResponse.data.accountType = response.fields["32"].ascii;
      }
      if (response.fields["36"]) {
        webResponse.data.last4 = response.fields["36"].ascii;
      }
      if (response.fields["95"]) {
        webResponse.data.maskedPan = response.fields["95"].ascii;
      }
      if (response.fields["43"]) {
        webResponse.data.receiptNumber = response.fields["43"].ascii;
      }
      if (response.fields["46"]) {
        webResponse.data.transactionDate = response.fields["46"].ascii;
      }
      if (response.fields["47"]) {
        webResponse.data.transactionTime = response.fields["47"].ascii;
      }

      logger.info("Compra procesada", {
        transactionId,
        success: response.success,
        amount: value.amount,
      });

      res.json(webResponse);
    } catch (error) {
      logger.error("Error en endpoint /purchase:", error);

      res.status(500).json({
        status: "error",
        message: error.message,
        code: error.code || "INTERNAL_ERROR",
      });
    }
  });

  /**
   * @api {post} /reversal Anular transacción
   * @apiName Reversal
   * @apiGroup Transactions
   */
  router.post("/reversal", async (req, res) => {
    try {
      const { error, value } = reversalSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: "error",
          message: error.details[0].message,
        });
      }

      // TODO: Implementar lógica de anulación
      // Similar a /purchase pero con header de anulación

      res.json({
        status: "ok",
        message: "Anulación iniciada (no implementada)",
        data: value,
      });
    } catch (error) {
      logger.error("Error en endpoint /reversal:", error.message);
      res.status(500).json({
        status: "error",
        message: error.message,
      });
    }
  });

  /**
   * @api {get} /status Estado del servicio y conexión serial
   * @apiName Status
   * @apiGroup General
   */
  router.get("/status", (req, res) => {
    const status = serialManager.getStatus();
    res.json({
      status: "ok",
      connected: status.connected,
      port: status.port,
      baudRate: status.baudRate,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  });

  return router;
}
