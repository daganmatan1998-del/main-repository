// End-of-period review and setting up the next period (cut → maintain → bulk …).

import { h, icon, clear, sheet, fmt, signed, parseNum, toast, ltr } from '../util.js';
import { segmented, assessmentBox } from '../components.js';
import { GOALS, assessGoal, projectBf, nextGoalSuggestions, validBf } from '../nutrition.js';
import { state, activePeriod, currentMetrics, startNextPeriod } from '../store.js';

export function openPeriodReview({ early = false } = {}) {
  const p = activePeriod();
  const cur = currentMetrics();
  const suggestions = nextGoalSuggestions(p.goal);
  const d = { goal: suggestions[0], weeks: 8, targetWeight: '', targetBf: '', touched: false };

  const defaults = () => {
    if (d.touched) return;
    let tw = cur.weight;
    if (d.goal === 'cut') tw = cur.weight * (1 - 0.006 * d.weeks);
    if (d.goal === 'bulk') tw = cur.weight * (1 + 0.0025 * d.weeks);
    d.targetWeight = String(Math.round(tw * 10) / 10);
    const pb = projectBf(d.goal, cur.weight, cur.bf, tw);
    d.targetBf = pb !== null ? String(pb) : '';
  };
  defaults();

  sheet(early ? 'סיום התקופה מוקדם' : 'סיכום התקופה', (close) => {
    const body = h('div');
    const draw = () => {
      clear(body);
      const dw = cur.weight - p.startWeight;
      const dbf = cur.bf != null && p.startBf != null ? cur.bf - p.startBf : null;
      body.append(
        h('div', { class: 'card flat' },
          h('h3', null, `תקופת ${GOALS[p.goal].label}`),
          h('div', { class: 'sum-row' }, h('span', null, 'משקל'), h('b', null, ltr(`${fmt(p.startWeight, 1)} → ${fmt(cur.weight, 1)} (${signed(dw)})`))),
          dbf !== null ? h('div', { class: 'sum-row' }, h('span', null, 'אחוז שומן'), h('b', null, ltr(`${p.startBf}% → ${cur.bf}% (${signed(dbf)})`))) : null,
          h('div', { class: 'sum-row' }, h('span', null, 'יעד'), h('b', { class: 'num' }, `${fmt(p.targetWeight, 1)} ק״ג, ${p.targetBf ?? '—'}%`))),
        h('h3', null, 'התקופה הבאה'),
        h('p', { class: 'muted small' }, `מומלץ אחרי ${GOALS[p.goal].label}: ${suggestions.map((g) => GOALS[g].label).join(' או ')}.`),
        h('div', { class: 'field' }, h('span', null, 'מטרה'),
          segmented(Object.entries(GOALS).map(([id, g]) => ({ id, label: g.label })), d.goal, (v) => { d.goal = v; d.touched = false; defaults(); draw(); }, 'מטרה')),
        h('div', { class: 'field' }, h('span', null, 'משך (שבועות)'),
          segmented([4, 8, 12, 16].map((n) => ({ id: n, label: String(n) })), d.weeks, (v) => { d.weeks = v; defaults(); draw(); }, 'משך')),
        h('div', { class: 'grid2' },
          h('label', { class: 'field' }, h('span', null, 'משקל יעד'), h('input', { inputmode: 'decimal', value: d.targetWeight, oninput: (e) => { d.targetWeight = e.target.value; d.touched = true; refresh(); } })),
          h('label', { class: 'field' }, h('span', null, '% שומן יעד'), h('input', { inputmode: 'decimal', value: d.targetBf, oninput: (e) => { d.targetBf = e.target.value; d.touched = true; refresh(); } }))),
        assess,
        h('button', {
          class: 'btn btn-primary btn-block',
          onclick: async () => {
            const a = assessment();
            if (a.level === 'error' || !validBf(parseNum(d.targetBf))) { toast('יש לתקן את היעד.'); return; }
            await startNextPeriod({ goal: d.goal, weeks: d.weeks, targetWeight: parseNum(d.targetWeight), targetBf: parseNum(d.targetBf) });
            close();
            toast('התקופה החדשה התחילה. התפריט עודכן.');
          },
        }, icon('check', 18), 'התחלת התקופה החדשה'));
      refresh();
    };
    const assess = h('div');
    const assessment = () => assessGoal({
      goal: d.goal, weeks: d.weeks, weight: cur.weight, bf: cur.bf,
      targetWeight: parseNum(d.targetWeight), targetBf: parseNum(d.targetBf), sex: state.profile.sex, height: state.profile.height,
    });
    const refresh = () => {
      clear(assess).appendChild(assessmentBox(assessment(), (patch) => {
        if (patch.weeks) d.weeks = patch.weeks;
        if (patch.targetWeight) d.targetWeight = String(patch.targetWeight);
        if (patch.targetBf) d.targetBf = String(patch.targetBf);
        d.touched = true;
        draw();
      }));
    };
    draw();
    return body;
  });
}
