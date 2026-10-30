/** 公开 UID 的密码学随机生成；唯一性由账号仓储的唯一索引及有限重试裁决。 */
import { randomBytes } from 'node:crypto';
import { checkedPublicId, PUBLIC_ID_ALPHABET, PUBLIC_ID_DATA_LENGTH } from '../src/shared/publicId';

/** 随机源仅由服务端装配或测试替换，不接收客户端提供的数据。 */
export function newPublicId(random: () => Uint8Array = () => randomBytes(PUBLIC_ID_DATA_LENGTH)): string {
  const bytes = random();
  if (bytes.length !== PUBLIC_ID_DATA_LENGTH) throw new Error('public-id-random-invalid');
  // 256 是字母表长度 32 的整数倍，取余不会造成字符概率偏差。
  const data = Array.from(bytes, value => PUBLIC_ID_ALPHABET[value % PUBLIC_ID_ALPHABET.length]).join('');
  return checkedPublicId(data);
}
