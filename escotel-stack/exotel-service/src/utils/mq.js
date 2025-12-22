import amqplib from 'amqplib';

let connection;
let channel;
let mqAvailable = null; // null = unknown, true = available, false = unavailable

export async function getChannel() {
  if (channel) return channel;
  const url = process.env.MQ_BROKER_URL;
  if (!url) {
    mqAvailable = false;
    return null;
  }
  try {
    connection = await amqplib.connect(url);
    channel = await connection.createChannel();
    mqAvailable = true;
    return channel;
  } catch (err) {
    console.warn('RabbitMQ not available:', err.message);
    mqAvailable = false;
    return null;
  }
}

export async function publish(queue, payload) {
  try {
    const ch = await getChannel();
    if (!ch) {
      // MQ not available - log and continue
      console.log(`[MQ-SKIP] ${queue}:`, JSON.stringify(payload).substring(0, 100));
      return;
    }
    await ch.assertQueue(queue, { durable: true });
    const body = Buffer.from(JSON.stringify(payload));
    ch.sendToQueue(queue, body, { persistent: true, contentType: 'application/json' });
  } catch (err) {
    console.warn('MQ publish failed:', err.message);
    // Don't throw - allow service to continue without MQ
  }
}

export async function close() {
  try { await channel?.close(); } catch {}
  try { await connection?.close(); } catch {}
  channel = undefined; connection = undefined;
}

export function isMqAvailable() {
  return mqAvailable === true;
}
