import type { Config, Mode } from '../config';
import type { HookLang } from '../random';

const CTA: Record<Mode, Record<HookLang, string>> = {
  escape: { vi: 'Bạn đoán bao lâu thì đầy? 👇', en: 'Guess how long until it fills up 👇' },
  infinite: { vi: 'Đếm thử xem có bao nhiêu bóng 😵', en: 'Try counting them 😵' },
  grow: { vi: 'Đoán xem nó có lấp kín không? 👇', en: 'Will it fill the circle? 👇' },
  destruction: { vi: 'Bạn nghĩ mất bao lâu? Comment nhé 👇', en: 'How long do you think it takes? 👇' },
  accumulation: { vi: 'Bao nhiêu bóng sẽ bị kẹt? 🤔', en: 'How many will get stuck? 🤔' },
  collision: { vi: 'Xem đến cuối nhé 💥', en: 'Watch till the end 💥' },
  spiral: { vi: 'Nó có thoát ra được không? 🌀', en: 'Will it make it out? 🌀' },
  trail: { vi: 'Thỏa mãn không? 😌', en: 'Satisfying, right? 😌' },
  merge: { vi: 'Lên được cấp cao nhất không? 🫧', en: 'Can it reach the top level? 🫧' },
  koth: { vi: 'Chọn màu của bạn ở comment! 👑', en: 'Pick your colour in the comments! 👑' },
  symmetric: { vi: 'Hiệu ứng cánh bướm thật đáng sợ 🦋', en: 'The butterfly effect is wild 🦋' },
};

const MODE_TAGS: Record<Mode, string[]> = {
  escape: ['#willitescape', '#ballescape'],
  infinite: ['#infiniteballs', '#exponential'],
  grow: ['#growingball'],
  destruction: ['#ringbreak', '#destruction'],
  accumulation: ['#spikes', '#glassbreak'],
  collision: ['#collision', '#explosion'],
  spiral: ['#spiral', '#escape'],
  trail: ['#painting', '#art'],
  merge: ['#merge', '#suika'],
  koth: ['#kingofthehill', '#battle', '#whowins'],
  symmetric: ['#butterflyeffect', '#chaostheory'],
};

const BASE_TAGS = ['#satisfying', '#oddlysatisfying', '#asmr', '#physics', '#bouncingball', '#simulation', '#fyp'];
const VI_TAGS = ['#xuhuong', '#thugian', '#vatly'];

/** Caption + call to action + hashtags for TikTok / Shorts / Reels. */
export function makeCaption(cfg: Config, lang: HookLang): string {
  const hook = cfg.title.replace(/\s+/g, ' ').trim();
  const cta = CTA[cfg.mode][lang];
  const tags = [...MODE_TAGS[cfg.mode], ...BASE_TAGS, ...(lang === 'vi' ? VI_TAGS : [])];
  if (cfg.battle > 1) tags.unshift('#splitscreen');
  if (cfg.chaos.length) tags.push('#plottwist');
  return `${hook}\n${cta}\n\n${[...new Set(tags)].join(' ')}\n`;
}
