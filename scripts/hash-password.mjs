import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
// No password arguments or echoes: avoid shell history and terminal output exposure.
if (!process.stdin.isTTY) {
  console.error('대화형 터미널에서 npm run password:hash 를 실행하세요.');
  process.exitCode = 1;
} else {
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const input = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    process.stdout.write('사용할 비밀번호 (입력은 표시되지 않습니다): ');
    const password = await input.question('');
    process.stdout.write('\n비밀번호 다시 입력: ');
    const confirm = await input.question('');
    if (
      password !== confirm ||
      password.length < 8 ||
      password.length > 128 ||
      Buffer.byteLength(password) > 512
    )
      throw new Error('비밀번호가 같아야 하며 8~128자로 입력해야 합니다.');
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    console.log(`\n\nPASSWORD=scrypt$${salt.toString('hex')}$${hash.toString('hex')}`);
    console.log(
      '위 값을 .env.local 및 배포 서버 환경변수 PASSWORD에 넣으세요. 원래 비밀번호는 UI에서 입력합니다.',
    );
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  } finally {
    input.close();
  }
}
