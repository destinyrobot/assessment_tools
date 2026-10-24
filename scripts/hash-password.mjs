#!/usr/bin/env node
/**
 * Generates a PBKDF2-SHA256 password hash for test codes / admin accounts.
 *
 *   npm run hash:password -- "my-secret-code"
 *
 * The plaintext is never written to disk or to stdout.
 */
import { hashPassword } from '../shared/password.ts';

const input = process.argv[2];
if (!input) {
  console.error('用法: npm run hash:password -- "你的密码"');
  console.error('建议密码长度 >= 10 位，混合大小写字母、数字与符号。');
  process.exit(1);
}

const hash = await hashPassword(input);
console.log('\n将下面这串哈希写入数据库（明文密码请自行保管，不要提交到仓库）：\n');
console.log(hash);
console.log('');