// AUTO-GENERATED FROM shared/ — do not edit here.
// Run `npm run sync:shared` after editing the files in shared/.
import type { Question } from './types.ts';

/**
 * 24 original questions, 4 options each.
 * Every dimension receives exactly three questions (8 x 3 = 24).
 * Option weights are integers in [-2, 2]; positive pushes the dimension toward
 * its `high` pole, negative toward its `low` pole.
 */
export const QUESTIONS: readonly Question[] = [
  // ---------- 分析直觉 / 决策与判断 ----------
  {
    id: 'q01',
    section: '决策与判断',
    text: '你面前有两个都挺不错的机会，但你只了解其中一个的全部细节。这时候你更可能怎么做？',
    options: [
      { id: 'a', label: '先把已知的部分拆开算一遍，算清楚了再决定', weights: { analysis: 2 } },
      { id: 'b', label: '列个表对比一下，但主要还是凭第一感觉选', weights: { analysis: 1, imagination: 1 } },
      { id: 'c', label: '跟着当下的心动走，先抓住再说', weights: { analysis: -2, imagination: 1 } },
      { id: 'd', label: '问问身边信得过的朋友，让他们帮我判断', weights: { analysis: -1, autonomy: -1 } },
    ],
  },
  {
    id: 'q02',
    section: '决策与判断',
    text: '别人跟你说一件事时，你脑子里最先冒出来的是什么？',
    options: [
      { id: 'a', label: '"所以这意味着什么"，我习惯自己往下推演', weights: { analysis: 2 } },
      { id: 'b', label: '一个画面或者一种感觉，模模糊糊的', weights: { analysis: -2, imagination: 1 } },
      { id: 'c', label: '"这事儿有多大影响"，先估个量级', weights: { analysis: 1, resilience: 1 } },
      { id: 'd', label: '"对方是什么心态"，我习惯先读人', weights: { analysis: -1, expression: 1, intimacy: 1 } },
    ],
  },
  {
    id: 'q03',
    section: '决策与判断',
    text: '回头看自己做过的重要决定，哪一类让你事后最满意？',
    options: [
      { id: 'a', label: '信息查得够多才下手的那次', weights: { analysis: 2, stability: 1 } },
      { id: 'b', label: '当时直觉很响、就冲了的那次', weights: { analysis: -2, stability: -1 } },
      { id: 'c', label: '和重要的人商量完才定的', weights: { analysis: -1, autonomy: -1 } },
      { id: 'd', label: '当时看得很远、赌的是以后那次', weights: { analysis: 1, imagination: 1, mission: 1 } },
    ],
  },

  // ---------- 稳健冒险 / 风险与节奏 ----------
  {
    id: 'q04',
    section: '风险与节奏',
    text: '一个稳定但天花板明显的机会，和一个不稳定但上限高很多的机会，你选哪个？',
    options: [
      { id: 'a', label: '稳的那个，我需要它一直在', weights: { stability: 2 } },
      { id: 'b', label: '上限高的那个，不试一下不甘心', weights: { stability: -2 } },
      { id: 'c', label: '先拿稳的保底，再拿一部分精力去试高风险那个', weights: { stability: 1, imagination: 1 } },
      { id: 'd', label: '看这个方向我到底有多在乎，在乎就选高的', weights: { stability: -1, mission: 2 } },
    ],
  },
  {
    id: 'q05',
    section: '风险与节奏',
    text: '你的工作或者生活节奏更像哪一种？',
    options: [
      { id: 'a', label: '有固定的节奏、可预期的安排，我待着踏实', weights: { stability: 2 } },
      { id: 'b', label: '每天都不一样，我讨厌被计划框住', weights: { stability: -2 } },
      { id: 'c', label: '大方向要稳，具体怎么走随当天状态', weights: { stability: 1, autonomy: 1 } },
      { id: 'd', label: '被一件想做成的事推着走，累但有劲', weights: { stability: -1, mission: 1, resilience: 1 } },
    ],
  },
  {
    id: 'q06',
    section: '风险与节奏',
    text: '一笔本来能稳稳拿到的钱，你会因为"可能翻倍"而放弃它吗？',
    options: [
      { id: 'a', label: '不会。稳稳拿到才是本事', weights: { stability: 2, mission: -1 } },
      { id: 'b', label: '会。但不是每次，得看这次我有多想试', weights: { stability: -1, mission: 1 } },
      { id: 'c', label: '会，只要输了我也输得起', weights: { stability: -2, resilience: 1 } },
      { id: 'd', label: '看这笔钱对我意味着什么，不是绝对值', weights: { stability: 1, intimacy: 1 } },
    ],
  },

  // ---------- 独立协作 / 协作与独立 ----------
  {
    id: 'q07',
    section: '协作与独立',
    text: '一个项目交给你，没人管你怎么做。你的状态是？',
    options: [
      { id: 'a', label: '爽，我能一整块时间沉在里面，效率最高', weights: { autonomy: 2 } },
      { id: 'b', label: '需要有人在旁边，出点声我反而更有劲', weights: { autonomy: -2 } },
      { id: 'c', label: '先自己做一轮，卡住了再找人', weights: { autonomy: 1, analysis: 1 } },
      { id: 'd', label: '喜欢几个人一起讨论着推进', weights: { autonomy: -1, expression: 1 } },
    ],
  },
  {
    id: 'q08',
    section: '协作与独立',
    text: '团队里没人说话的时候，通常是谁先开口？',
    options: [
      { id: 'a', label: '不是我，但我会观察谁会开口', weights: { autonomy: 1, expression: -1 } },
      { id: 'b', label: '我基本都会先打破沉默', weights: { expression: 2, autonomy: -1 } },
      { id: 'c', label: '看议题，重要的我会说', weights: { expression: 1, analysis: 1 } },
      { id: 'd', label: '我更愿意会后单独找人说', weights: { expression: -2, intimacy: 1 } },
    ],
  },
  {
    id: 'q09',
    section: '协作与独立',
    text: '你更享受哪种"完成感"？',
    options: [
      { id: 'a', label: '一件事从零到有，全是我一个人捏出来的', weights: { autonomy: 2 } },
      { id: 'b', label: '一群人一起拼，最后成了', weights: { autonomy: -2 } },
      { id: 'c', label: '把一件卡住的事救回来', weights: { resilience: 2, analysis: 1 } },
      { id: 'd', label: '帮到具体某个人，我会有强烈的满足感', weights: { autonomy: -1, mission: 1, intimacy: 1 } },
    ],
  },

  // ---------- 想象落地 / 创意与执行 ----------
  {
    id: 'q10',
    section: '创意与执行',
    text: '你脑子里冒出一个特别棒的点子，接下来最让你兴奋的是？',
    options: [
      { id: 'a', label: '把它在脑子里再打磨一遍，做到无懈可击', weights: { imagination: 2, analysis: 1 } },
      { id: 'b', label: '赶紧做出来哪怕很粗糙，先有个东西在手', weights: { imagination: -2, resilience: 1 } },
      { id: 'c', label: '找人一起聊，看能不能擦出点新东西', weights: { imagination: 1, autonomy: -1 } },
      { id: 'd', label: '想象它真的被很多人喜欢的那一天', weights: { imagination: 1, mission: 1, expression: 1 } },
    ],
  },
  {
    id: 'q11',
    section: '创意与执行',
    text: '你更常出现的状态是？',
    options: [
      { id: 'a', label: '一边做一边冒新想法，经常跑偏', weights: { imagination: 2 } },
      { id: 'b', label: '按计划推进，做完再想下一步', weights: { imagination: -2 } },
      { id: 'c', label: '想到就记下来，等有空了再评估', weights: { imagination: 1, stability: 1 } },
      { id: 'd', label: '反复琢磨，但真正动手的次数不多', weights: { imagination: 1, analysis: 1, resilience: -1 } },
    ],
  },
  {
    id: 'q12',
    section: '创意与执行',
    text: '如果让你在"想得出"和"做得出"之间选一个天赋，你选？',
    options: [
      { id: 'a', label: '想得出。我能看见别人看不见的结构', weights: { imagination: 1, analysis: 2 } },
      { id: 'b', label: '做得出。我能把粗糙的东西变成能用的', weights: { imagination: -2, resilience: 1 } },
      { id: 'c', label: '都行，我更在意最后能不能真的落地', weights: { imagination: -1, mission: 1 } },
      { id: 'd', label: '得看跟谁一起，想法和执行都能互相带', weights: { imagination: 1, autonomy: -1 } },
    ],
  },

  // ---------- 承压卸压 / 压力与恢复 ----------
  {
    id: 'q13',
    section: '压力与恢复',
    text: 'deadline 提前三天，而活儿还剩一半。你的第一反应是？',
    options: [
      { id: 'a', label: '压上去，通宵也得弄完', weights: { resilience: 2 } },
      { id: 'b', label: '先停下来睡一觉，第二天效率翻倍', weights: { resilience: -2 } },
      { id: 'c', label: '把活儿切开，先啃最要紧的那块', weights: { resilience: 1, analysis: 2 } },
      { id: 'd', label: '找人一起分掉点，边聊边做', weights: { resilience: 1, autonomy: -1 } },
    ],
  },
  {
    id: 'q14',
    section: '压力与恢复',
    text: '长期高压下，你的身体和情绪最先给什么信号？',
    options: [
      { id: 'a', label: '还能扛，看不出什么，直到真扛不住了', weights: { resilience: 2, intimacy: -1 } },
      { id: 'b', label: '很早就烦了、累了，需要停下来', weights: { resilience: -2 } },
      { id: 'c', label: '会找人说出来，说完就好了', weights: { resilience: -1, expression: 2, intimacy: 1 } },
      { id: 'd', label: '会一个人默默消化掉，谁也不说', weights: { resilience: 1, intimacy: -2 } },
    ],
  },
  {
    id: 'q15',
    section: '压力与恢复',
    text: '你心里那个"我很能扛"的标准，来自于？',
    options: [
      { id: 'a', label: '被交付过很难的事，而且我真的做成了', weights: { resilience: 2, mission: 1 } },
      { id: 'b', label: '我更在意别把自己搞垮，长期战更重要', weights: { resilience: -1, stability: 2 } },
      { id: 'c', label: '看情况，硬扛和休息我都需要', weights: { resilience: 1, intimacy: 1 } },
      { id: 'd', label: '其实没那么想扛，我只是不太会求助', weights: { resilience: -1, intimacy: -1, expression: -1 } },
    ],
  },

  // ---------- 意义回报 / 价值与回报 ----------
  {
    id: 'q16',
    section: '价值与回报',
    text: '如果要你写一句话解释自己为什么干这份活儿，你更想写哪句？',
    options: [
      { id: 'a', label: '"因为它有意义"', weights: { mission: 2 } },
      { id: 'b', label: '"因为它回报不错"', weights: { mission: -2 } },
      { id: 'c', label: '"因为我擅长，也没人比我做得更好"', weights: { mission: -1, analysis: 2 } },
      { id: 'd', label: '"因为我需要它，需要这个安全感"', weights: { mission: -1, stability: 2 } },
    ],
  },
  {
    id: 'q17',
    section: '价值与回报',
    text: '一份工作做了三年，你最舍不得的是什么？',
    options: [
      { id: 'a', label: '我喜欢的那部分，它让我觉得自己在长', weights: { mission: 2, imagination: 1 } },
      { id: 'b', label: '积累下来的经验和位置', weights: { mission: -1, stability: 2 } },
      { id: 'c', label: '一起扛事的那帮人', weights: { autonomy: -2, intimacy: 1 } },
      { id: 'd', label: '我在这件事上确实厉害', weights: { mission: -1, analysis: 1, resilience: 1 } },
    ],
  },
  {
    id: 'q18',
    section: '价值与回报',
    text: '如果收入一样，你会选哪一份？',
    options: [
      { id: 'a', label: '能直接帮到具体的人的工作', weights: { mission: 2, intimacy: 1 } },
      { id: 'b', label: '能把事情做到极致、可以看到结果的工作', weights: { mission: 1, analysis: 1, imagination: -1 } },
      { id: 'c', label: '门槛高、我很难被替代的岗位', weights: { stability: 2, mission: -1 } },
      { id: 'd', label: '自由度高、我能自己定规则的活儿', weights: { autonomy: 2, mission: -1 } },
    ],
  },

  // ---------- 外放内收 / 表达与边界 ----------
  {
    id: 'q19',
    section: '表达与边界',
    text: '你和一个明显 disagree 的人聊天，会发生什么？',
    options: [
      { id: 'a', label: '我会当场说出来，哪怕气氛会僵', weights: { expression: 2 } },
      { id: 'b', label: '我不会当面提，但心里已经全记住了', weights: { expression: -2 } },
      { id: 'c', label: '看场合，也会用比较软的方式提', weights: { expression: 1 } },
      { id: 'd', label: '我会先确认是不是我理解错了', weights: { expression: -1, analysis: 1, intimacy: 1 } },
    ],
  },
  {
    id: 'q20',
    section: '表达与边界',
    text: '别人情绪上来找你时，你通常？',
    options: [
      { id: 'a', label: '我会接住，让对方把话说完', weights: { expression: 2, intimacy: 1 } },
      { id: 'b', label: '会有点不知所措，事后想很久', weights: { expression: -2, intimacy: 1 } },
      { id: 'c', label: '会给一些具体建议，帮对方把事解决掉', weights: { expression: 1, analysis: 1, resilience: 1 } },
      { id: 'd', label: '会先岔开话题，等气氛好了再说', weights: { expression: -1, stability: 1 } },
    ],
  },
  {
    id: 'q21',
    section: '表达与边界',
    text: '被冒犯到的时候，你更可能？',
    options: [
      { id: 'a', label: '当场就说了，我不是一个会忍的人', weights: { expression: 2 } },
      { id: 'b', label: '忍住，回家再消化', weights: { expression: -2 } },
      { id: 'c', label: '看对方是不是故意的，再决定说不说', weights: { expression: 1, analysis: 1 } },
      { id: 'd', label: '算了，我不想为这种消耗自己情绪', weights: { expression: -1, stability: 1, intimacy: -1 } },
    ],
  },

  // ---------- 贴近留白 / 亲密与距离 ----------
  {
    id: 'q22',
    section: '亲密与距离',
    text: '和最亲近的人，你理想的相处状态是？',
    options: [
      { id: 'a', label: '每天黏在一起，什么都share', weights: { intimacy: 2 } },
      { id: 'b', label: '各有一块自己的地方，偶尔靠近就很好', weights: { intimacy: -2, autonomy: 1 } },
      { id: 'c', label: '有事能深聊，没事也不尴尬', weights: { intimacy: 1, expression: 1 } },
      { id: 'd', label: '越熟越能说真话，越生分越客气', weights: { intimacy: 2, expression: -1 } },
    ],
  },
  {
    id: 'q23',
    section: '亲密与距离',
    text: '吵架之后，你更需要的是？',
    options: [
      { id: 'a', label: '马上和好，别让事情过夜', weights: { intimacy: 2, expression: 1 } },
      { id: 'b', label: '各自冷静，等情绪真的下去了再说', weights: { intimacy: -1, resilience: 1 } },
      { id: 'c', label: '我需要先搞清楚自己为什么这么在意', weights: { intimacy: -1, analysis: 2 } },
      { id: 'd', label: '希望对方能主动来找我说清楚', weights: { intimacy: 2, expression: -1 } },
    ],
  },
  {
    id: 'q24',
    section: '亲密与距离',
    text: '你怎么看待"被需要"这件事？',
    options: [
      { id: 'a', label: '被需要让我感觉自己有用、也踏实', weights: { intimacy: 2 } },
      { id: 'b', label: '被需要太多会压垮我，我需要留白', weights: { intimacy: -2, autonomy: 1 } },
      { id: 'c', label: '看是谁需要我，差别很大', weights: { intimacy: 1, analysis: 1 } },
      { id: 'd', label: '我喜欢能照顾别人，但不想被照顾', weights: { intimacy: 1, expression: 1, resilience: 1 } },
    ],
  },
];

export const QUESTION_COUNT = QUESTIONS.length;

export const QUESTION_IDS: readonly string[] = QUESTIONS.map((q) => q.id);