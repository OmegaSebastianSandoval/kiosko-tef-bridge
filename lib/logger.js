import winston from "winston";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Crear directorio de logs si no existe
const logDir = join(__dirname, "..", "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "tef-bridge" },
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, service }) => {
          return `[${timestamp}] ${service} ${level}: ${message}`;
        }),
      ),
    }),
    // File output
    new winston.transports.File({
      filename: join(logDir, "tef-bridge.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Error file
    new winston.transports.File({
      filename: join(logDir, "error.log"),
      level: "error",
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// Helper para loguear tramas hex
export const logHex = (data, prefix = "") => {
  if (Buffer.isBuffer(data)) {
    logger.debug(`${prefix} HEX: ${data.toString("hex").toUpperCase()}`);
    // logger.debug(`${prefix} ASCII: ${data.toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);
  } else if (typeof data === "string") {
    logger.debug(`${prefix}: ${data}`);
  }
};
