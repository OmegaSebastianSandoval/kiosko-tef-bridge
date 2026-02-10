/**
 * Punto de entrada principal - Puente TEF II
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

// Configuración
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar variables de entorno
dotenv.config({ path: join(__dirname, ".env") });

// Cargar configuración
const configPath = join(__dirname, "config.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

// Importar módulos
import { logger } from "./lib/logger.js";
import { SerialManager } from "./lib/SerialManager.js";
import { TEFProtocol } from "./lib/TEFProtocol.js";
import { createApiRouter } from "./routes/api.js";

// Aplicación Express
const app = express();

// Middleware
app.use(
  cors({
    origin: config.server.cors_origins,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variables globales
let serialManager;
let server;
// Determinar modo automáticamente
const isDevelopment =
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV === "mock" ||
  process.platform === "darwin"; // Mac

if (isDevelopment) {
  config.tef.mockMode = true;
  logger.info("Modo desarrollo detectado, activando modo mock");
}
/**
 * Inicializar servicios
 */
async function initialize() {
  try {
    logger.info("=== Iniciando Puente TEF II ===");
    logger.info(`Node.js ${process.version}`);
    logger.info(`Entorno: ${process.env.NODE_ENV || "development"}`);

    // Inicializar gestor serial
    serialManager = new SerialManager(config.serial);

    // Conectar al datáfono
    await serialManager.connect();

    // Crear router API
    const apiRouter = createApiRouter(serialManager, TEFProtocol);

    // Rutas
    app.use("/api", apiRouter);

    // Ruta de bienvenida
    app.get("/", (req, res) => {
      res.json({
        service: "tef-bridge",
        version: "1.0.0",
        endpoints: {
          health: "GET /api/health",
          status: "GET /api/status",
          purchase: "POST /api/purchase",
          reversal: "POST /api/reversal",
        },
        documentation: "/docs/api",
      });
    });

    // Manejo de errores 404
    app.use((req, res) => {
      console.log(req);
      
      res.status(404).json({
        status: "error",
        message: `Ruta no encontrada: ${req.method} ${req.path}`,
      });
    });

    // Manejo de errores global
    app.use((error, req, res, next) => {
      logger.error(`Error global: ${error.message}`, { stack: error.stack });
      res.status(500).json({
        status: "error",
        message: "Error interno del servidor",
        ...(process.env.NODE_ENV === "development" && {
          detail: error.message,
        }),
      });
    });

    // Iniciar servidor HTTP
    server = app.listen(config.server.port, config.server.host, () => {
      logger.info(
        `Servidor HTTP en http://${config.server.host}:${config.server.port}`,
      );
      logger.info("=== Servicio listo ===");
    });

    // Manejar cierre limpio
    setupGracefulShutdown();
  } catch (error) {
    logger.error(`Error inicializando servicio: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Configurar cierre limpio
 */
function setupGracefulShutdown() {
  const shutdown = async (signal) => {
    logger.info(`Recibido ${signal}, cerrando servicio...`);

    try {
      // Cerrar servidor HTTP
      if (server) {
        await new Promise((resolve) => {
          server.close(resolve);
        });
        logger.info("Servidor HTTP cerrado");
      }

      // Desconectar serial
      if (serialManager) {
        await serialManager.disconnect();
        logger.info("Conexión serial cerrada");
      }

      logger.info("Servicio cerrado correctamente");
      process.exit(0);
    } catch (error) {
      logger.error(`Error durante el cierre: ${error.message}`);
      process.exit(1);
    }
  };

  // Capturar señales de terminación
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

  // Capturar excepciones no manejadas
  process.on("uncaughtException", (error) => {
    logger.error("Excepción no manejada:", error);
    shutdown("UNCAUGHT_EXCEPTION");
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Promesa rechazada no manejada:", reason);
    shutdown("UNHANDLED_REJECTION");
  });
}

/**
 * Iniciar aplicación
 */
initialize();
