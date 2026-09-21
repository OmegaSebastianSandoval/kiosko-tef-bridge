/**
 * Autenticacion HTTP Basic para los endpoints del puente.
 *
 * Solo protege el trafico entre la aplicacion web y este servicio: el puente
 * queda expuesto por un tunel publico (ngrok), asi que sin esto cualquiera que
 * conozca la URL podria disparar una compra en el datafono.
 *
 * Las credenciales se leen del .env (BRIDGE_AUTH_USER / BRIDGE_AUTH_PASS) y
 * deben coincidir con API_DATAFONO_USER / API_DATAFONO_PASS del bootstrap.php.
 */

import { timingSafeEqual } from "crypto";
import { logger } from "./logger.js";

/** Comparacion en tiempo constante, tolerante a longitudes distintas. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createBasicAuth({ user, password, realm = "tef-bridge" } = {}) {
  if (!user || !password) {
    throw new Error(
      "Credenciales del puente sin configurar (BRIDGE_AUTH_USER / BRIDGE_AUTH_PASS)",
    );
  }

  return function basicAuth(req, res, next) {
    const rechazar = (motivo) => {
      logger.warn(
        `Acceso rechazado (${motivo}): ${req.method} ${req.path} desde ${req.ip}`,
      );
      res.set("WWW-Authenticate", `Basic realm="${realm}", charset="UTF-8"`);
      return res.status(401).json({
        status: "error",
        message: "No autorizado",
      });
    };

    const header = req.headers.authorization || "";
    if (!header.toLowerCase().startsWith("basic ")) {
      return rechazar("sin cabecera Authorization");
    }

    const credenciales = Buffer.from(header.slice(6), "base64").toString(
      "utf8",
    );
    const separador = credenciales.indexOf(":");
    if (separador === -1) {
      return rechazar("cabecera malformada");
    }

    const recibidoUser = credenciales.slice(0, separador);
    const recibidoPass = credenciales.slice(separador + 1);

    // Se evaluan ambas siempre para no filtrar por tiempo si el usuario existe.
    const okUser = safeEqual(recibidoUser, user);
    const okPass = safeEqual(recibidoPass, password);

    if (!okUser || !okPass) {
      return rechazar("credenciales invalidas");
    }

    next();
  };
}
