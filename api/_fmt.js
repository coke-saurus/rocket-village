// 디스코드 메시지용 포켓몬·보수 표기 (밑줄 파일: 주소로 공개되지 않음)
import { clip } from './_lib.js';

export const STATS = [['hp', '체력'], ['atk', '공격'], ['def', '방어'], ['spa', '특공'], ['spd', '특방'], ['spe', '스피드']];
export const won = (n) => Number(n || 0).toLocaleString('ko-KR');

// 포켓몬 정보 → 디스코드 필드
export function pkFields(pk) {
  if (!pk) return [];
  const iv = STATS.map(([k, n]) => {
    const v = pk.ivs?.[k];
    const mark = pk.nature?.up === k ? '▲' : pk.nature?.dn === k ? '▼' : '';
    return `${n}${mark} ${v == null ? '－' : v}`;
  }).join(' · ');
  return [
    { name: '포켓몬', value: clip(`${pk.shiny ? '✨ 이로치 ' : ''}${pk.name}`, 200), inline: true },
    { name: '특성', value: pk.ability ? `${pk.ability.n}${pk.ability.hidden ? ' (숨겨진 특성)' : ''}` : '상관없음', inline: true },
    { name: '성격', value: pk.nature?.n || '상관없음', inline: true },
    { name: '개체값', value: clip(iv, 1000) },
    ...(pk.level !== undefined ? [{ name: '최대 레벨', value: pk.level ? `Lv.${pk.level}` : '상관없음', inline: true }] : []),
  ];
}
export function rewardText(r, pk) {
  if (!r) return null;
  const lines = [`${won(r.gold)} 골드`];
  const iv = [r.strict ? '타협 불가' : r.less ? `${won(r.less)} 골드/-1` : '', r.more ? `${won(r.more)} 골드/+1` : ''].filter(Boolean);
  if (iv.length) lines.push(`요구 개체값: ${iv.join(' · ')}`);
  if (pk?.level && (r.lvStrict || r.lvLess)) lines.push(`레벨(최대 Lv.${pk.level}): ${r.lvStrict ? '타협 불가' : `${won(r.lvLess)} 골드/-1`}`);
  if (r.other) lines.push(`+ ${r.other}`);
  return lines.join('\n');
}
export const ts = (iso) => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:f> (<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>)`;

