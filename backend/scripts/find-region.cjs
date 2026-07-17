const net = require('net');
const tls = require('tls');

const regions = [
  'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1', 'ap-southeast-2',
  'us-east-1', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2',
  'eu-central-1', 'ap-south-1', 'sa-east-1', 'ca-central-1',
];

const ref = 'xugmxibdqiffhklhsawu';
const user = 'postgres.' + ref;

// Build a minimal Postgres startup message
function buildStartupMessage(user, database) {
  const params = 'user\0' + user + '\0database\0' + database + '\0\0';
  const len = 4 + 4 + params.length;
  const buf = Buffer.alloc(len);
  buf.writeInt32BE(len, 0);
  buf.writeInt32BE(196608, 4); // protocol version 3.0
  buf.write(params, 8);
  return buf;
}

async function tryRegion(region) {
  const host = 'aws-0-' + region + '.pooler.supabase.com';
  const port = 6543;
  
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 5000 }, () => {
      const msg = buildStartupMessage(user, 'postgres');
      socket.write(msg);
    });
    
    let data = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      const str = data.toString('utf8', 0, Math.min(data.length, 200));
      socket.destroy();
      if (str.includes('not found')) {
        resolve({ region, status: 'not-found' });
      } else if (str.includes('password') || data[0] === 82) { // 'R' = AuthenticationRequest
        resolve({ region, status: 'FOUND', host });
      } else {
        resolve({ region, status: 'other: ' + str.substring(0, 60) });
      }
    });
    
    socket.on('error', (e) => resolve({ region, status: 'error: ' + e.message }));
    socket.setTimeout(5000, () => { socket.destroy(); resolve({ region, status: 'timeout' }); });
  });
}

(async () => {
  for (const r of regions) {
    const result = await tryRegion(r);
    if (result.status === 'FOUND') {
      console.log('*** FOUND! Region:', result.region, '-> Host:', result.host);
      break;
    } else if (result.status !== 'not-found') {
      console.log(result.region, '->', result.status);
    }
  }
  console.log('Done.');
})();
