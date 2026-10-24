import { BRAND } from '@/config/brand';
import { BulletList, Card, Divider, SectionTitle, Tag } from '@/components/ui/Card';
import { DimensionChart, DimensionGrid } from './DimensionChart';
import { DIMENSIONS } from '@shared/dimensions.ts';
import type { Report } from '@shared/types.ts';

function Emblem({ report, size = 84 }: { report: Report; size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-3xl font-serif font-semibold text-white shadow-soft"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(140deg, ${report.palette.accent}, #3A2E26)`,
      }}
      aria-hidden
    >
      {report.archetypeGlyph}
    </div>
  );
}

/** On-screen report. Interactive controls live outside this component. */
export function ReportView({ report }: { report: Report }) {
  const palette = report.palette;
  return (
    <article className="space-y-6">
      <Card
        className="relative overflow-hidden p-6 sm:p-9"
        style={{ backgroundImage: `radial-gradient(circle at 88% 6%, ${palette.soft}, transparent 46%)` }}
      >
        <div className="flex flex-wrap items-start gap-5">
          <Emblem report={report} />
          <div className="min-w-[12rem] flex-1">
            <Tag>{BRAND.name}</Tag>
            <h1 className="mt-3 font-serif text-[28px] font-semibold leading-tight tracking-wide text-ink sm:text-[36px]">
              {report.archetypeName}
            </h1>
            <p className="mt-2 font-serif text-[15px] text-brown-soft sm:text-[17px]">{report.tagline}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {report.keywords.map((k) => (
                <Tag key={k} tone="plain">
                  {k}
                </Tag>
              ))}
            </div>
          </div>
        </div>
        <Divider />
        <p className="text-pretty text-[15.5px] leading-[1.95] text-brown-soft">{report.oneLiner}</p>
        <p className="mt-4 rounded-2xl border border-line/70 bg-cream/60 px-4 py-3 text-[13.5px] leading-[1.85] text-brown-soft">
          第二原型是
          <span className="mx-1 font-medium text-ink">{report.secondaryArchetypeName}</span>
          · {report.balanced
            ? '你的八个维度得分很接近，是少见的均衡配置。'
            : `最高分「${DIMENSIONS[report.strongest].name}」${report.scores[report.strongest]}，最低分「${DIMENSIONS[report.weakest].name}」${report.scores[report.weakest]}，跨度 ${report.spread} 分。`}
        </p>
      </Card>

      <Card className="p-5 sm:p-7">
        <SectionTitle index="01" title="八个维度" hint="分数区间 0–100，50 表示两边都不偏。" />
        <DimensionChart scores={report.scores} />
        <div className="mt-6 space-y-3 border-t border-line/70 pt-5">
          {report.dimensionNotes.slice(0, 3).map((note) => (
            <p key={note.id} className="text-[13.5px] leading-[1.85] text-brown-soft">
              <span className="font-medium text-ink">{note.name}</span>（{note.score}）—— {note.note}
            </p>
          ))}
        </div>
      </Card>

      <Card className="p-5 sm:p-7">
        <SectionTitle index="02" title="你的性格底色" />
        <BulletList items={report.coreTraits} />
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card className="p-5 sm:p-7">
          <SectionTitle index="03" title="主要优势" />
          <BulletList items={report.strengths} marker="dash" />
        </Card>
        <Card className="p-5 sm:p-7">
          <SectionTitle index="04" title="潜在盲区" />
          <BulletList items={report.blindSpots} marker="dash" />
        </Card>
      </div>

      <Card className="p-5 sm:p-7">
        <SectionTitle
          index="05"
          title="适合探索的职业方向"
          hint="方向由原型匹配与你的最高分维度共同推导，理由写在每一项后面。"
        />
        <ul className="space-y-4">
          {report.career.directions.map((d) => (
            <li key={d.title} className="rounded-2xl border border-line/70 bg-cream/50 p-4">
              <h3 className="font-serif text-[16px] font-semibold text-ink">{d.title}</h3>
              <p className="mt-1.5 text-[14px] leading-[1.85] text-brown-soft">{d.reason}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card className="p-5 sm:p-7">
          <SectionTitle index="06" title="适合的工作环境" />
          <BulletList items={report.workEnvironment.suited} />
        </Card>
        <Card className="p-5 sm:p-7">
          <SectionTitle index="07" title="容易让你有压力的环境" />
          <BulletList items={report.workEnvironment.stressful} />
        </Card>
      </div>

      <Card className="p-5 sm:p-7">
        <SectionTitle index="08" title="人际沟通倾向" />
        <p className="rounded-2xl bg-orange-wash/60 px-4 py-3.5 text-[14.5px] leading-[1.9] text-[#7d4a20]">
          {report.communication.style}
        </p>
        <div className="mt-4">
          <BulletList items={report.communication.tips} marker="dash" />
        </div>
      </Card>

      <Card className="p-5 sm:p-7">
        <SectionTitle index="09" title="亲密关系中的你" hint="仅供自我参照，关系取决于具体的人。" />
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-[14px] font-medium text-ink">你的需求</h3>
            <BulletList items={report.relationship.needs} />
          </div>
          <div>
            <h3 className="mb-2 text-[14px] font-medium text-ink">你的优势</h3>
            <BulletList items={report.relationship.strengths} marker="dash" />
          </div>
          <div>
            <h3 className="mb-2 text-[14px] font-medium text-ink">可能的摩擦点</h3>
            <BulletList items={report.relationship.frictions} marker="dash" />
          </div>
          <div>
            <h3 className="mb-2 text-[14px] font-medium text-ink">建议的相处方式</h3>
            <BulletList items={report.relationship.partnerTips} marker="num" />
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-7">
        <SectionTitle index="10" title="三条可以马上开始做的建议" />
        <ol className="space-y-3.5">
          {report.growth.map((item, i) => (
            <li key={item} className="flex gap-3.5">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-orange font-mono text-[12px] font-semibold text-white">
                {i + 1}
              </span>
              <p className="text-[14.5px] leading-[1.85] text-brown-soft">{item}</p>
            </li>
          ))}
        </ol>
      </Card>

      <p className="px-1 text-[12px] leading-[1.9] text-brown-muted">{BRAND.disclaimer}</p>
    </article>
  );
}

/**
 * Dedicated PNG template. Rendered off-screen at a fixed 750px width so the
 * export is identical on every device and nothing gets clipped.
 */
export function ExportCard({ report }: { report: Report }) {
  const pal = report.palette;
  return (
    <div
      style={{
        width: 750,
        background: 'linear-gradient(180deg,#FFFCF7 0%,#FBF6EE 45%,#F3E9DA 100%)',
        color: '#3A2E26',
        fontFamily:
          "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif",
        padding: '40px 36px 44px',
      }}
    >
      <Section title="维度得分" index="01" />
      <div style={{ padding: '0 2px' }}>
        <DimensionGrid scores={report.scores} />
      </div>
      <Rule />

      <Section title="性格底色" index="02" />
      <List items={report.coreTraits} />

      <Section title="优势与盲区" index="03" />
      <TwoCol
        left={{ title: '主要优势', items: report.strengths }}
        right={{ title: '潜在盲区', items: report.blindSpots }}
      />

      <Section title="职业方向" index="04" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {report.career.directions.map((d) => (
          <div
            key={d.title}
            style={{
              border: '1px solid #E7D9C6',
              borderRadius: 16,
              background: 'rgba(255,255,255,0.72)',
              padding: '12px 14px',
            }}
          >
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{d.title}</p>
            <p style={{ margin: '5px 0 0', fontSize: 13.5, lineHeight: 1.75, color: '#6B5749' }}>
              {d.reason}
            </p>
          </div>
        ))}
      </div>

      <Section title="关系与沟通" index="05" />
      <Block title="沟通倾向" body={report.communication.style} />
      <Block title="关系中的需求" body={report.relationship.needs.join(' / ')} />
      <Block title="可能的摩擦点" body={report.relationship.frictions.join(' / ')} />

      <Section title="马上可以开始做的事" index="06" />
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {report.growth.map((item, i) => (
          <li key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: 999,
                background: pal.accent,
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: 13.5, lineHeight: 1.8, color: '#6B5749' }}>{item}</span>
          </li>
        ))}
      </ol>

      <Rule />
      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.8, color: '#9A8878' }}>
        {BRAND.disclaimer}
      </p>
    </div>
  );
}

function Section({ index, title }: { index: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '26px 0 14px' }}>
      <span
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          color: '#D2762F',
          border: '1px solid rgba(210,118,47,0.3)',
          borderRadius: 999,
          padding: '2px 8px',
        }}
      >
        {index}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.06em' }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: '#E7D9C6' }} />
    </div>
  );
}

function Rule() {
  return <div style={{ height: 1, margin: '26px 0 0', background: '#E7D9C6' }} />;
}

function List({ items }: { items: readonly string[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item) => (
        <li key={item} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <span style={{ flexShrink: 0, marginTop: 9, width: 5, height: 5, borderRadius: 999, background: '#D2762F' }} />
          <span style={{ fontSize: 13.5, lineHeight: 1.8, color: '#6B5749' }}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function TwoCol({ left, right }: { left: { title: string; items: readonly string[] }; right: { title: string; items: readonly string[] } }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {[left, right].map((col) => (
        <div
          key={col.title}
          style={{
            border: '1px solid #E7D9C6',
            borderRadius: 16,
            background: 'rgba(255,255,255,0.72)',
            padding: '12px 14px',
          }}
        >
          <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>{col.title}</p>
          <List items={col.items} />
        </div>
      ))}
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ margin: '0 0 4px', fontSize: 13.5, fontWeight: 700 }}>{title}</p>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8, color: '#6B5749' }}>{body}</p>
    </div>
  );
}

export { Emblem };