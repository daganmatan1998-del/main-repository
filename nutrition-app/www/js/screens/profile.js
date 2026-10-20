// Profile & settings.

import { t as tr } from '../i18n.js';
import { h, icon, sheet, toast, fmt, fmtDate, parseNum, ltr, signed } from '../util.js';
import { metricsForm, segmented, stepper, disclaimer, dietNoteBox, avatar } from '../components.js';
import { GOALS, ACTIVITY } from '../nutrition.js';
import { ALLERGENS, DIETS, FOODS, FOOD_BY_ID, parseDislikes, dislikeMatches } from '../foods.js';
import { openFoodPicker, pickerLabel } from './food-picker.js';
import { state, targets, activePeriod, currentMetrics, addMetrics, updateProfile, saveSettings, wipe, currentWeek, setAvatar } from '../store.js';
import { openPeriodReview } from './period.js';
import { enableReminders, disableReminders, downloadCalendar, supported as notifSupported } from '../notify.js';
import { disablePush, pushSupported, needsInstall } from '../push.js';
import { openRemindersSheet } from './reminders.js';
import { canInstall, isStandalone, promptInstall } from '../install.js';
import { applyTheme } from '../theme.js';
import { languageBar } from './language.js';
import { APP_VERSION, BILLING } from '../config.js';
import { openPaywall } from './paywall.js';
import { aiStatus } from '../store.js';
import { photoButtons } from './photo-picker.js';
import { squareImage } from '../image.js';
import { accountCard } from './account.js';
import { friendsCard, openInviteSheet } from './friends.js';
import { challengesCard } from './challenges.js';
import { cloudReady } from '../cloud.js';
import * as cloud from '../cloud.js';

export function renderProfile(root) {
  const p = state.profile;
  const per = activePeriod();
  const cur = currentMetrics();
  const t = targets();

  root.appendChild(h('header', { class: 'profile-head' },
    h('button', { class: 'avatar-btn', id: 'btn-avatar', 'aria-label': tr('Change profile photo'), onclick: editAvatar },
      avatar(84), h('span', { class: 'avatar-badge' }, icon('camera', 16))),
    h('div', { class: 'profile-id' },
      h('h1', null, p.nickname || p.name),
      p.nickname ? h('p', { class: 'muted' }, p.name) : null,
      h('p', { class: 'muted small' }, tr('Joined {0} · week {1}', fmtDate(p.regDay, true), currentWeek())),
      cloudReady() ? h('button', { type: 'button', class: 'btn btn-small btn-primary', id: 'btn-invite-head', onclick: openInviteSheet }, icon('send', 16), tr('Invite friends')) : null)));

  // ---- personal details (first: who this profile is) ----
  root.appendChild(h('section', { class: 'card', id: 'details-card' },
    h('div', { class: 'row space' }, h('h2', null, tr('Personal details')), h('button', { class: 'btn btn-small btn-ghost', id: 'btn-edit-details', onclick: editDetails }, icon('edit', 16), tr('Edit'))),
    h('div', { class: 'kv' },
      h('span', null, tr('Name')), h('b', null, p.name),
      h('span', null, tr('Nickname')), h('b', { id: 'kv-nickname' }, p.nickname || '—'),
      h('span', null, tr('Sex, age, height')), h('b', null, tr('{0}, {1}, {2} cm', p.sex === 'female' ? tr('Female') : tr('Male'), p.age, p.height)),
      h('span', null, tr('Activity')), h('b', null, tr('{0} · {1, plural, one {# workout} other {# workouts}} a week', ACTIVITY[p.activity].label, p.workouts)))));

  // ---- cloud account ----
  root.appendChild(accountCard());
  const friends = friendsCard();
  if (friends) root.appendChild(friends);
  const challenges = challengesCard();
  if (challenges) root.appendChild(challenges);

  // ---- plan for the AI features ----
  if (BILLING.enabled) {
    const a = aiStatus();
    root.appendChild(h('section', { class: 'card', id: 'plan-card' },
      h('div', { class: 'row space' },
        h('h2', null, tr('Nutri Plus')),
        h('span', { class: `badge ${a.state}` }, a.state === 'active' ? tr('Active') : a.state === 'trial' ? tr('Trial') : tr('Inactive'))),
      h('p', { class: 'muted small' }, a.state === 'active' ? tr('Your subscription is active until {0}.', fmtDate(new Date(a.until).toISOString().slice(0, 10)))
        : a.state === 'trial' ? tr('{0, plural, one {# trial day} other {# trial days}} left for the smart assistant and the calorie camera.', a.daysLeft)
          : tr('The smart assistant and the calorie camera are available with a subscription. Everything else is free.')),
      h('button', { class: 'btn btn-block btn-primary', id: 'btn-plan', onclick: () => openPaywall('') }, a.state === 'active' ? tr('Subscription details') : tr('Upgrade'))));
  }

  // ---- metrics ----
  root.appendChild(h('section', { class: 'card' },
    h('h2', null, tr('Update weight and body fat')),
    h('p', { class: 'muted small' }, tr('Last: {0} kg, {1}% ({2}). Every update recalculates your plan.', fmt(cur.weight, 1), cur.bf ?? '—', fmtDate(cur.day))),
    metricsForm({
      submitLabel: tr('Update and recalculate'),
      previous: cur,
      person: () => ({ sex: p.sex, age: p.age, height: p.height }),
      onSubmit: async (w, b) => {
        await addMetrics(w, b, 'manual');
        toast(tr('Your measurements were saved and the plan was updated'));
      },
    })));

  // ---- period & targets ----
  root.appendChild(h('section', { class: 'card', id: 'period-settings' },
    h('h2', null, tr('Current period: {0}', GOALS[per.goal].label)),
    h('div', { class: 'kv' },
      h('span', null, tr('Dates')), h('b', null, tr('From {0} to {1}', fmtDate(per.startDate), fmtDate(per.endDate))),
      h('span', null, tr('Target')), h('b', { class: 'num' }, tr('{0} kg · {1}%', fmt(per.targetWeight, 1), per.targetBf ?? '—')),
      h('span', null, tr('Daily target')), h('b', null, tr('{0} kcal · protein {1} · carbs {2} · fat {3} g', fmt(t.calories), t.protein, t.carbs, t.fat)),
      h('span', null, tr('Metabolism')), h('b', null, tr('Resting {0} · with activity {1} kcal', fmt(t.bmr), fmt(t.tdee)), h('small', { class: 'muted', dir: 'ltr' }, ` ${t.method}`)),
      h('span', null, tr('Planned pace')), h('b', null, ltr(signed(t.plannedKgPerWeek, 2)), tr(' kg per week'))),
    h('button', { class: 'btn btn-block', onclick: () => openPeriodReview({ early: true }) }, tr('End the period and set a new one'))));

  // ---- details & preferences ----
  const diet = DIETS.find((x) => x.id === p.prefs.diet)?.label;
  const allergies = (p.prefs.allergies || []).map((a) => ALLERGENS.find((x) => x.id === a)?.label).join(', ') || tr('None');
  root.appendChild(h('section', { class: 'card' },
    h('div', { class: 'row space' }, h('h2', null, tr('Food preferences')), h('button', { class: 'btn btn-small btn-ghost', onclick: editPrefs }, icon('edit', 16), tr('Edit'))),
    h('div', { class: 'kv' },
      h('span', null, tr('Diet')), h('b', null, `${diet}${p.prefs.kosher ? tr(' · kosher') : ''}`),
      h('span', null, tr('Allergies')), h('b', null, allergies),
      h('span', null, tr('Don\'t eat')), h('b', null, [p.prefs.dislikes, ...(p.prefs.excluded || []).map((id) => FOOD_BY_ID[id]?.name)].filter(Boolean).join(', ') || '—'),
      h('span', null, tr('Meals per day')), h('b', null, String(p.prefs.mealsPerDay)))));

  // ---- app settings ----
  const remindersToggle = h('input', {
    type: 'checkbox', role: 'switch', checked: state.settings.reminders, disabled: !notifSupported(),
    onchange: async (e) => {
      if (e.target.checked) {
        const r = await enableReminders();
        if (r !== 'granted') { e.target.checked = false; toast(r === 'denied' ? tr('Notifications are blocked in the browser settings.') : tr('Notifications are not supported here.')); } else toast(tr('Notifications are on'));
      } else {
        await disableReminders();
      }
    },
  });
  // Daily meal reminders (Web Push; see push.js). Turning on opens the sheet that asks permission.
  const pushToggle = h('input', {
    type: 'checkbox', role: 'switch', id: 'push-toggle', checked: !!state.settings.push, disabled: !pushSupported() && !needsInstall(),
    onchange: async (e) => {
      if (e.target.checked) {
        e.target.checked = false;
        openRemindersSheet({ onDone: () => window.dispatchEvent(new Event('app:rerender')) });
      } else {
        await disablePush();
        toast(tr('Notifications are off'));
      }
    },
  });
  root.appendChild(h('section', { class: 'card' },
    h('h2', null, tr('Settings')),
    h('div', { class: 'field' }, h('span', null, tr('Language‖setting')), languageBar()),
    h('div', { class: 'field' }, h('span', null, tr('Appearance')),
      segmented([{ id: 'system', label: tr('Use device setting') }, { id: 'light', label: tr('Light') }, { id: 'dark', label: tr('Dark') }], state.settings.theme,
        async (v) => { await saveSettings({ theme: v }); applyTheme(v); }, tr('Color scheme'))),
    h('label', { class: 'switch-row' },
      h('span', null, h('strong', null, tr('Notifications from Nutri')), !pushSupported() && needsInstall() ? h('small', { class: 'muted' }, tr('On iPhone: first add the app to your home screen')) : !pushSupported() ? h('small', { class: 'muted' }, tr('This device does not support notifications')) : null),
      pushToggle),
    h('label', { class: 'switch-row' },
      h('span', null, h('strong', null, tr('Weekly photo reminder')), h('small', { class: 'muted' }, notifSupported() ? tr('A notification on photo day (when the browser supports it)') : tr('This browser does not support notifications — use the calendar'))),
      remindersToggle),
    h('button', { class: 'btn btn-block', onclick: () => downloadCalendar(p.regDay, currentWeek()) }, icon('bell', 18), tr('Add a weekly reminder to your calendar')),
    isStandalone()
      ? h('p', { class: 'muted small' }, icon('check', 14), tr(' The app is installed on this device.'))
      : canInstall() ? h('button', { class: 'btn btn-block', onclick: () => promptInstall() }, icon('download', 18), tr('Install the app on your home screen')) : null));

  // ---- privacy ----
  const storageInfo = h('p', { class: 'muted small' }, tr('Checking storage…'));
  (async () => {
    try {
      const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
      const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
      storageInfo.textContent = `${est ? tr('In use: {0} MB. ', (est.usage / 1048576).toFixed(1)) : ''}${persisted ? tr('Storage is protected from automatic deletion.') : tr('The browser may free up storage if the device fills up — installing the app lowers the risk.')}`;
    } catch { storageInfo.textContent = ''; }
  })();
  root.appendChild(h('section', { class: 'card' },
    h('h2', null, tr('Privacy')),
    h('ul', { class: 'bullets small' },
      cloud.signedIn()
        ? h('li', null, icon('lock', 16), tr('Your data is kept on your device and in your private cloud account, which only you can access. Progress photos {0}', state.settings.photoBackup ? tr('are backed up in the account too.') : tr('are kept only on the device (photo backup is off).')))
        : h('li', null, icon('lock', 16), tr('All your data — including photos and body measurements — is kept only on this device. If you sign in, a copy is also kept in the cloud.')),
      h('li', null, icon('chat', 16), tr('When you ask the assistant, only the needed nutrition data (age, measurements, goal, menu and restrictions) is sent — never your name or photos.')),
      h('li', null, icon('info', 16), cloud.signedIn() ? tr('"Delete all data" below also removes it from the cloud and deletes the account itself.') : tr('Deleting the app or clearing the browser\'s site data also deletes your data.'))),
    storageInfo,
    h('button', { class: 'btn btn-danger btn-block', id: 'btn-delete-all', onclick: deleteAll }, icon('trash', 18), tr('Delete all data'))));

  root.appendChild(disclaimer());
  root.appendChild(h('p', { class: 'muted small center' }, tr('Version {0}', APP_VERSION)));
}

function editDetails() {
  const p = state.profile;
  const d = { name: p.name, nickname: p.nickname || '', age: String(p.age), height: String(p.height), activity: p.activity, workouts: p.workouts, sex: p.sex };
  sheet(tr('Edit details'), (close) => {
    const err = h('p', { class: 'field-err', role: 'alert' });
    return h('div', { class: 'form' },
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, tr('Name')), h('input', { id: 'ed-name', autocomplete: 'given-name', value: d.name, oninput: (e) => { d.name = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, tr('Nickname')), h('input', { id: 'ed-nickname', placeholder: tr('How should we address you?'), maxlength: 20, value: d.nickname, oninput: (e) => { d.nickname = e.target.value; } }))),
      h('div', { class: 'field' }, h('span', null, tr('Sex')), segmented([{ id: 'male', label: tr('Male') }, { id: 'female', label: tr('Female') }], d.sex, (v) => { d.sex = v; }, tr('Sex'))),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, tr('Age')), h('input', { inputmode: 'numeric', value: d.age, oninput: (e) => { d.age = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, tr('Height (cm)')), h('input', { inputmode: 'numeric', value: d.height, oninput: (e) => { d.height = e.target.value; } }))),
      h('div', { class: 'field' }, h('span', null, tr('Daily activity')),
        segmented(Object.entries(ACTIVITY).map(([id, a]) => ({ id, label: a.label })), d.activity, (v) => { d.activity = v; }, tr('Activity'))),
      h('div', { class: 'field' }, h('span', null, tr('Workouts per week')), stepper(d.workouts, 0, 14, (v) => { d.workouts = v; }, tr('Workouts'))),
      err,
      h('button', {
        class: 'btn btn-primary btn-block',
        onclick: async () => {
          const age = parseNum(d.age);
          const height = parseNum(d.height);
          const name = d.name.trim();
          if (name.length < 2) { err.textContent = tr('Enter a name (at least 2 characters).'); return; }
          if (!(age >= 16 && age <= 90) || !(height >= 120 && height <= 230)) { err.textContent = tr('Age 16–90, height 120–230 cm.'); return; }
          await updateProfile({ name, nickname: d.nickname.trim().slice(0, 20), age, height, activity: d.activity, workouts: d.workouts, sex: d.sex });
          close();
          toast(tr('Your details were updated and the plan was recalculated'));
        },
      }, tr('Save')));
  });
}

function editAvatar() {
  sheet(tr('Profile photo'), (close) => h('div', { class: 'form', id: 'avatar-sheet' },
    h('div', { class: 'center' }, avatar(120)),
    photoButtons(async (img) => {
      await setAvatar(img);
      close();
      toast(tr('The profile photo was updated'));
    }, { process: squareImage, front: true, hint: false, busyText: tr('Preparing the photo…') }),
    state.avatar ? h('button', {
      class: 'btn btn-ghost btn-block', id: 'btn-avatar-remove',
      onclick: async () => { await setAvatar(null); close(); toast(tr('The profile photo was removed')); },
    }, icon('trash', 18), tr('Remove photo')) : null));
}

function editPrefs() {
  const p = state.profile.prefs;
  const d = { diet: p.diet, kosher: !!p.kosher, allergies: [...(p.allergies || [])], dislikes: p.dislikes || '', excluded: [...(p.excluded || [])], mealsPerDay: p.mealsPerDay };
  const dietNote = dietNoteBox(d.diet);
  sheet(tr('Food preferences'), (close) => {
    const preview = h('div', { class: 'muted small', 'aria-live': 'polite' });
    const upd = () => {
      const hit = FOODS.filter((f) => dislikeMatches(f, parseDislikes(d.dislikes))).map((f) => f.name);
      preview.textContent = hit.length ? tr('Taken out of the menu: {0}', hit.join(', ')) : '';
    };
    upd();
    return h('div', { class: 'form' },
      h('div', { class: 'field' }, h('span', null, tr('Diet type')), segmented(DIETS.map((x) => ({ id: x.id, label: x.label.split(' (')[0] })), d.diet, (v) => { d.diet = v; dietNote.update(v); }, tr('Diet type')), dietNote.el),
      h('label', { class: 'switch-row' }, h('span', null, h('strong', null, tr('Kosher'))),
        h('input', { type: 'checkbox', role: 'switch', checked: d.kosher, onchange: (e) => { d.kosher = e.target.checked; } })),
      h('div', { class: 'field' }, h('span', null, tr('Allergies')),
        h('div', { class: 'chips' }, ...ALLERGENS.map((a) => h('button', {
          type: 'button', class: 'chip' + (d.allergies.includes(a.id) ? ' on' : ''), 'aria-pressed': d.allergies.includes(a.id) ? 'true' : 'false',
          onclick: (e) => {
            d.allergies = d.allergies.includes(a.id) ? d.allergies.filter((x) => x !== a.id) : [...d.allergies, a.id];
            e.currentTarget.classList.toggle('on');
            e.currentTarget.setAttribute('aria-pressed', d.allergies.includes(a.id) ? 'true' : 'false');
          },
        }, a.label)))),
      h('label', { class: 'field' }, h('span', null, tr('Foods I don\'t eat')),
        h('input', { value: d.dislikes, oninput: (e) => { d.dislikes = e.target.value; upd(); } }), preview),
      h('button', {
            type: 'button', class: 'btn btn-block', id: 'btn-food-picker',
            onclick: (e) => {
              const btn = e.currentTarget;
              openFoodPicker(d, (ids) => { d.excluded = ids;  btn.lastChild.textContent = pickerLabel(ids); });
            },
          }, icon('edit', 18), h('span', null, pickerLabel(d.excluded))),
      h('div', { class: 'field' }, h('span', null, tr('Meals per day')),
        segmented([3, 4, 5, 6].map((n) => ({ id: n, label: String(n) })), d.mealsPerDay, (v) => { d.mealsPerDay = v; }, tr('Meals per day'))),
      h('button', {
        class: 'btn btn-primary btn-block',
        onclick: async () => {
          await updateProfile({ prefs: { ...d, dislikes: d.dislikes.trim() } });
          close();
          toast(tr('Your preferences were saved and the menu was updated'));
        },
      }, tr('Save')));
  });
}

function deleteAll() {
  sheet(tr('Delete all data'), (close) => {
    const input = h('input', { id: 'confirm-delete', placeholder: tr('Type: delete'), autocomplete: 'off' });
    const btn = h('button', { class: 'btn btn-danger btn-block', id: 'confirm-delete-btn', disabled: true }, tr('Delete permanently'));
    input.addEventListener('input', () => { btn.disabled = input.value.trim().toLowerCase() !== tr('delete').toLowerCase(); });
    const withCloud = cloud.signedIn();
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      if (withCloud) {
        try {
          await cloud.deleteAccount();
        } catch {
          btn.disabled = false;
          toast(tr('We couldn\'t delete your data from the cloud account (an internet connection is needed). Nothing was deleted.'));
          return;
        }
      }
      try {
        await wipe();
      } catch {
        btn.disabled = false;
        toast(tr('Couldn\'t delete — close any other tabs with the app open and try again.'));
        return;
      }
      close();
      location.hash = '';
      location.reload();
    });
    return h('div', { class: 'form' },
      h('p', null, withCloud
        ? tr('This will delete your profile, plan, all measurements, photos and chats from this device and the cloud account, and close the account. It cannot be undone.')
        : tr('This will delete your profile, plan, all measurements, photos and chats from this device. It cannot be undone.')),
      h('label', { class: 'field' }, h('span', null, tr('To confirm, type "delete"')), input),
      btn);
  });
}
