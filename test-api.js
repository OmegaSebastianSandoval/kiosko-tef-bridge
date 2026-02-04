/**
 * Prueba los endpoints HTTP del puente TEF
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

async function testAPI() {
    console.log('=== PRUEBA API TEF BRIDGE ===\n');
    
    // 1. Health check
    console.log('1. Probando health check...');
    try {
        const health = await fetch(`${BASE_URL}/api/health`);
        const healthData = await health.json();
        console.log('   ✅ Health:', healthData.status);
        console.log('   Mock mode:', healthData.serial?.isMockMode);
    } catch (error) {
        console.log('   ❌ Servicio no disponible');
        return;
    }
    
    // 2. Status
    console.log('\n2. Probando status...');
    const status = await fetch(`${BASE_URL}/api/status`);
    const statusData = await status.json();
    console.log('   ✅ Status:', statusData);
    
    // 3. Compra de prueba
    console.log('\n3. Probando compra...');
    const purchaseData = {
        amount: 150000,  // $1,500 pesos
        terminalId: 'CAJA01',
        cashierId: 'EMPLEADO_TEST',
        transactionId: `TEST_${Date.now()}`,
        tip: 0,
        sendPan: true
    };
    
    console.log('   Enviando:', purchaseData);
    
    const purchase = await fetch(`${BASE_URL}/api/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(purchaseData)
    });
    
    const purchaseResult = await purchase.json();
    
    if (purchaseResult.status === 'ok') {
        console.log('   ✅ Compra exitosa!');
        console.log('   Transacción ID:', purchaseResult.data.transactionId);
        console.log('   Autorización:', purchaseResult.data.authCode);
        console.log('   Monto:', purchaseResult.data.amount);
        console.log('   Recibo:', purchaseResult.data.receiptNumber);
    } else {
        console.log('   ❌ Error:', purchaseResult.message);
    }
    
    console.log('\n=== PRUEBAS COMPLETADAS ===');
}

// Ejecutar
testAPI().catch(console.error);