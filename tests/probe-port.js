/**
 * Diagnóstico aislado del puerto serial.
 * Uso: node tests/probe-port.js [COM3]
 *
 * No depende del bridge: habla directamente con serialport para
 * distinguir un problema de driver de uno de configuración.
 */

import { SerialPort } from "serialport";

const target = process.argv[2] || "COM3";

console.log(`Node: ${process.version}`);
console.log(`Plataforma: ${process.platform} ${process.arch}`);

const ports = await SerialPort.list();
console.log(`\n--- Puertos enumerados (${ports.length}) ---`);
for (const p of ports) {
  console.log(
    `  ${p.path}  |  ${p.manufacturer || "sin fabricante"}  |  VID:${p.vendorId || "-"} PID:${p.productId || "-"}`,
  );
}

if (!ports.some((p) => p.path.toUpperCase() === target.toUpperCase())) {
  console.log(`\n⚠  ${target} NO aparece en la lista de serialport.`);
}

// Probar distintas configuraciones: si unas abren y otras no,
// el driver rechaza parámetros concretos, no el puerto en sí.
const configs = [
  { baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" },
  { baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none", rtscts: false },
  { baudRate: 19200, dataBits: 8, stopBits: 1, parity: "none" },
  { baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none" },
  { baudRate: 9600, dataBits: 7, stopBits: 1, parity: "even" },
];

console.log(`\n--- Intentos de apertura en ${target} ---`);
for (const cfg of configs) {
  const label = `${cfg.baudRate} ${cfg.dataBits}${cfg.parity[0].toUpperCase()}${cfg.stopBits}${cfg.rtscts === false ? " sin-rtscts" : ""}`;
  try {
    await new Promise((resolve, reject) => {
      const port = new SerialPort({ path: target, ...cfg, autoOpen: false });
      port.open((err) => {
        if (err) return reject(err);
        port.close(() => resolve());
      });
    });
    console.log(`  ✅ ${label}  → ABRE`);
  } catch (err) {
    console.log(`  ❌ ${label}  → ${err.message}`);
  }
}
