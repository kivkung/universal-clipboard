import fs from 'node:fs';
import path from 'node:path';
import { atomicJson } from './state.js';
import { hashText } from './protocol.js';

// Receipt callbacks only persist work. Awaiting a network request inside them
// would block the same socket reader that must process its acknowledgement.
export function relayReceivedFiles(endpoint, dir, log) {
  const tasksDir = path.join(dir, 'relay');
  fs.mkdirSync(tasksDir, { recursive: true, mode: 0o700 });
  let running = false, dirty = false;
  const drain = async () => {
    if (running || !endpoint.ready || endpoint.stopped) return;
    running = true; dirty = false;
    try {
      for (const filename of fs.readdirSync(tasksDir).filter(name => name.endsWith('.json'))) {
        const taskPath = path.join(tasksDir, filename);
        const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
        if (!task.jobs) {
          const peers = (await endpoint.devices()).filter(peer => peer.id !== endpoint.id && peer.id !== task.receipt.sender);
          const members = task.receipt.members || [task.receipt];
          task.jobs = peers.map(peer => {
            const id = hashText(filename + ':' + peer.id);
            const files = members.map((member, index) => ({ file: member.output, name: member.name, size: member.size, hash: member.hash, kind: member.kind, mime: member.mime, transferId: hashText(id + ':' + index) }));
            return task.receipt.batch ? { batch: true, batchId: id, to: peer.id, distribute: false, files } : { ...files[0], transferId: id, to: peer.id, distribute: false };
          });
          atomicJson(taskPath, task);
        }
        // Persist every target before sending. Failed transfers use uc resume.
        for (const job of task.jobs) atomicJson(path.join(endpoint.jobsDir, (job.batch ? job.batchId : job.transferId) + '.json'), job);
        fs.unlinkSync(taskPath);
        for (const job of task.jobs) {
          try { await endpoint.runJob(job); log('Forwarded received files to ' + job.to); }
          catch (error) { log('Forward to ' + job.to + ': ' + error.message + '. Run uc resume.'); }
        }
      }
    } catch (error) { log('File forwarding: ' + error.message + '. Pending receipt retained for reconnect.'); }
    finally { running = false; if (dirty) setImmediate(() => void drain()); }
  };
  endpoint.on('received-files', receipt => {
    if (receipt.distribute === false || receipt.sender === endpoint.id) return;
    const id = hashText(receipt.sender + ':' + (receipt.batch ? 'batch:' + receipt.batchId : 'file:' + receipt.transferId));
    atomicJson(path.join(tasksDir, id + '.json'), { receipt });
    dirty = true; setImmediate(() => void drain());
  });
  endpoint.on('connected', () => setImmediate(() => void drain()));
}
