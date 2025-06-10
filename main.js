const fs = require('fs');
const { SuiClient, getFullnodeUrl } = require('@mysten/sui.js/client');
const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui.js/cryptography');
const { TransactionBlock } = require('@mysten/sui.js/transactions');
const readline = require('readline');

const NETWORK = 'testnet';
const PACKAGE_ID = '0x4995e309e990a6a93224153108b26bf79197b234c51db6447bbae10b431c42fb';
const VAULT_OBJECT_ID = '0xf280477ca196a4bced5e1db4cd82fcdd647b55585b1d3838dcd8e1b829d263a4';
const MIN_AMOUNT_MIST = 900000;    
const MAX_AMOUNT_MIST = 7000000;   
const MIN_DELAY_SEC = 2;          
const MAX_DELAY_SEC = 3;          

async function swapSuiForNBTC({
  privateKey,
  amountMist,
  vaultObjectId = VAULT_OBJECT_ID,
  gasBudgetMist = 4327728
}) {
  try {
    const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

    const keypair = getKeypair(privateKey);
    const senderAddress = keypair.getPublicKey().toSuiAddress();
    console.log(`Public key: ${senderAddress}`);

    const initialSharedVersion = await getInitialSharedVersion(client, vaultObjectId);
    
    const tx = buildTransaction({
      amountMist,
      vaultObjectId,
      initialSharedVersion,
      gasBudgetMist
    });

    const result = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { 
        showEffects: true, 
        showEvents: true,
        showInput: true
      }
    });

    const nbtcReceived = parseNBTCReceived(result.events);

    return {
      success: true,
      digest: result.digest,
      nbtcReceived,
      vaultUsed: vaultObjectId,
      packageUsed: PACKAGE_ID,
      explorerLink: `https://suiscan.xyz/testnet`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      vaultUsed: vaultObjectId,
      packageUsed: PACKAGE_ID
    };
  }
}

function getKeypair(privateKey) {
  try {
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch (error) {
    throw new Error(`Gagal memproses private key: ${error.message}`);
  }
}

async function getInitialSharedVersion(client, objectId) {
  const object = await client.getObject({ 
    id: objectId, 
    options: { showOwner: true }
  });
  
  if (!object.data || !object.data.owner) {
    throw new Error(`Vault object ${objectId} tidak ditemukan`);
  }
  
  if (object.data.owner.Shared) {
    return BigInt(object.data.owner.Shared.initial_shared_version);
  }
  
  throw new Error(`Object ${objectId} bukan shared object`);
}

function buildTransaction({ amountMist, vaultObjectId, initialSharedVersion, gasBudgetMist }) {
  const tx = new TransactionBlock();
  tx.setGasBudget(gasBudgetMist);

  const [coin] = tx.splitCoins(tx.gas, [tx.pure(amountMist)]);

  tx.moveCall({
    target: `${PACKAGE_ID}::nbtc_swap::swap_sui_for_nbtc`,
    arguments: [
      tx.sharedObjectRef({
        objectId: vaultObjectId,
        initialSharedVersion: initialSharedVersion.toString(),
        mutable: true
      }),
      coin
    ]
  });

  return tx;
}

function parseNBTCReceived(events) {
  if (!events || !events.length) return 0;
  
  const swapEvent = events.find(e => 
    e.type.includes('::nbtc_swap::SwapEvent') || 
    e.type.includes('::nbtc_swap::swap_sui_for_nbtc')
  );
  
  if (swapEvent && swapEvent.parsedJson) {
    return swapEvent.parsedJson.nbtc_amount / 1e9;
  }
  
  return 0;
}

function readPrivateKeyFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  return content;
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay() {
  const delaySeconds = getRandomInt(MIN_DELAY_SEC, MAX_DELAY_SEC);
  console.log(`⏳ Menunggu ${delaySeconds} detik sebelum swap berikutnya...`);
  return new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
}

async function main() {
  // Setup interface untuk input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const PRIVATE_KEY = readPrivateKeyFromFile('pk.txt');
  console.log(`Private key: ${PRIVATE_KEY.substring(0, 15)}...`);

  rl.question('Berapa kali swap yang ingin dilakukan? ', async (swapCount) => {
    const count = parseInt(swapCount);
    if (isNaN(count) || count <= 0) {
      console.log('Input tidak valid. Harus angka positif.');
      rl.close();
      return;
    }

    console.log(`\nMemulai ${count} swap acak...`);
    console.log(`Rentang jumlah: ${MIN_AMOUNT_MIST/1000000} - ${MAX_AMOUNT_MIST/1000000} SUI`);
    console.log(`Rentang jeda: ${MIN_DELAY_SEC} - ${MAX_DELAY_SEC} detik\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 1; i <= count; i++) {
      const amountMist = getRandomInt(MIN_AMOUNT_MIST, MAX_AMOUNT_MIST);
      console.log(`\n🚀 Swap #${i}/${count}: ${amountMist/1000000} SUI`);

      try {
        const result = await swapSuiForNBTC({
          privateKey: PRIVATE_KEY,
          amountMist: amountMist
        });

        if (result.success) {
          successCount++;
          console.log(`✅ Berhasil! Digest: ${result.digest}`);
          console.log(`💰 nBTC Received: ${result.nbtcReceived}`);
          console.log(`🌐 Explorer: ${result.explorerLink}`);
        } else {
          failCount++;
          console.error(`❌ Gagal: ${result.error}`);
        }
      } catch (error) {
        failCount++;
        console.error(`❌ Error: ${error.message}`);
      }

      if (i < count) {
        await randomDelay();
      }
    }

    console.log('\n====================================');
    console.log('🔥 SEMUA SWAP SELESAI!');
    console.log(`✅ Berhasil: ${successCount}`);
    console.log(`❌ Gagal: ${failCount}`);
    console.log('====================================');
    
    rl.close();
  });
}

main();
