/**
 * Script para probar el puente TEF sin datáfono físico
 */

import { SerialManager } from "./lib/SerialManager.js";
import { TEFProtocol } from "./lib/TEFProtocol.js";
import { logger } from "./lib/logger.js";

async function testMockMode() {
  console.log("=== PRUEBA MODO MOCK TEF ===\n");

  const config = {
    serial: {
      port: "COM3", // Ignorado en modo mock
      baudRate: 9600,
    },
    tef: {
      mockMode: true,
      timeoutTransaction: 5000,
    },
  };

  const serialManager = new SerialManager(config);
  await serialManager.connect();

  console.log("Estado:", serialManager.getStatus());

  // Probar diferentes escenarios
  const testCases = [
    {
      name: "Compra exitosa $50.000",
      data: {
        amount: 5000000, // 50,000 pesos en centavos
        transactionId: "TEST_001",
        terminalId: "TEST01",
        cashierId: "TESTER",
      },
    },
    {
      name: "Compra pequeña $10.000",
      data: {
        amount: 1000000,
        transactionId: "TEST_002",
        terminalId: "TEST01",
        cashierId: "TESTER",
        sendPan: true,
      },
    },
    {
      name: "Compra con propina $25.000",
      data: {
        amount: 2500000,
        tip: 250000, // 2,500 pesos de propina
        transactionId: "TEST_003",
        terminalId: "TEST01",
        cashierId: "TESTER",
      },
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n📋 Probando: ${testCase.name}`);
    console.log("Datos:", testCase.data);

    try {
      // Construir trama
      const frame = TEFProtocol.buildPurchaseFrame(testCase.data);
      console.log("Trama construida ✓");

      // Enviar y recibir (modo mock)
      const response = await serialManager.sendAndReceive(frame);

      console.log("✅ Respuesta recibida:");
      console.log("   Éxito:", response.success);
      console.log("   Mensaje:", response.message);
      console.log("   Código respuesta:", response.responseCode);

      if (response.success) {
        console.log("   Código autorización:", response.authCode);
        console.log("   Monto:", response.amount);
        console.log("   Últimos 4 dígitos:", response.last4);
        console.log("   Franquicia:", response.franchise);
      }

      // Pequeña pausa entre pruebas
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("❌ Error:", error.message);
    }
  }

  console.log("\n=== PRUEBA COMPLETADA ===");
  process.exit(0);
}

// Ejecutar prueba
testMockMode().catch(console.error);
