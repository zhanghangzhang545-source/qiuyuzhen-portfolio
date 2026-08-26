// ============================================================
// admin/about.js — 关于页数据真实 CRUD（Phase 3-C2）
// ------------------------------------------------------------
// 后台可写入口：展示并编辑从 Supabase About 表读取的简历数据。
// C2 解锁：profile / education / experience / skills / honors / contacts
//   增（upsert）/ 改（upsert）/ 删（remove）/ 排序（reorder）真实写 Supabase。
// C2 边界：不写媒体（avatar 留 C3）；Mock 模式同样可写（回滚通道）。
// ============================================================
import { h } from '../../../core/dom.js';
import { aboutRepo, auth, DATA_MODE } from '../../../data/services.js';
import { toast } from '../../components/primitives.js';
import { adminLayout } from './layout.js';

export async function adminAboutView() {
  // 会话/授权闸门（与 dashboard / workEdit / comicPages 一致）：
  if (DATA_MODE.value === 'supabase') {
    await auth.ensureSession();
    if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }
  } else {
    if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }
  }

  const isSupabase = DATA_MODE.value === 'supabase';
  const wrap = h('div', { class: 'admin__main-inner' }, h('div', { class: 'admin__loading' }, '读取中…'));

  (async () => {
    try {
      // #2：admin 用 readAdmin() 专属形状（含 id + sort_order），公共 read() 保持 C1 string[]
      const A = await aboutRepo.readAdmin();
      wrap.replaceChildren(renderBody(A, isSupabase));
    } catch (e) {
      wrap.replaceChildren(h('div', { class: 'admin__error' }, [
        h('h2', {}, '关于页数据读取失败'),
        h('p', {}, e.message || String(e)),
        h('p', { class: 'secondary' }, isSupabase
          ? '请检查网络连通性与云端配置。正式模式不会回退本地预览。'
          : '本地预览数据读取异常。'),
      ]));
    }
  })();

  return adminLayout('about', h('div', {}, [
    h('div', { class: 'admin__head' }, [
      h('h1', {}, '关于页数据（编辑）'),
      h('span', { class: isSupabase ? 'badge badge--live' : 'badge badge--readonly' }, isSupabase ? '已连接云端' : '本地预览模式'),
    ]),
    h('p', { class: 'secondary', style: { marginBottom: '16px' } }, '此页面可真实编辑「关于」页的来源数据（姓名 / 简介 / 教育 / 经历 / 技能 / 荣誉 / 联系）。增删与排序均写入云端（本地预览模式则保存于本机）。'),
    wrap,
  ]));
}

function field(label, control) {
  return h('div', { class: 'field' }, [
    h('label', { class: 'field__label' }, label),
    control,
  ]);
}

// 简单输入框工厂（受控：返回 {el, get, set}）
function input(value, placeholder) {
  const el = h('input', { type: 'text', value: value || '', placeholder: placeholder || '' });
  return { el, get: () => el.value, set: (v) => { el.value = v || ''; } };
}
function textarea(value, placeholder) {
  const el = h('textarea', { placeholder: placeholder || '' }, value || '');
  return { el, get: () => el.value, set: (v) => { el.value = v || ''; } };
}

// 列表型条目编辑器：每行可改 + 上移/下移/删除；顶部「+ 新增」按钮
// #9 修复：onReorder/onRemove/onAdd 均带统一状态反馈（saving / success / failure / unauthorized），
//       不再仅靠 toast。
// #2 修复：add / remove / reorder 全部经 coordinator（与 blur/Profile/ho7 同一 FIFO 队列），
//       绝不直接访问 repository，保证用户操作顺序 === DB 写入顺序（如 edit A → delete A
//       必须先 edit 完成再 delete，最终 A 不存在；edit A → reorder 先 edit 再 reorder）。
function makeListEditor(opts) {
  // opts: { items, renderRow, onReorder, onRemove, onAdd, addLabel, label, coordinator }
  // coordinator: (fn, label) => void —— 统一入队器（来自 renderBody 的 enqueueSave）
  const coordinator = opts.coordinator;
  let items = opts.items.slice();
  const listEl = h('div', { class: 'editable-list' });
  // #9 列表级状态条
  const listStatus = h('div', { class: 'form-status form-status--idle', 'aria-live': 'polite' });
  const setListStatus = (kind, msg) => { listStatus.textContent = msg; listStatus.className = `form-status form-status--${kind}`; };
  const refresh = () => {
    listEl.innerHTML = '';
    items.forEach((it, idx) => {
      const rowControls = opts.renderRow(it, () => {});
      const moveUp = h('button', { class: 'icon-btn', title: '上移', on: { click: () => {
        if (idx <= 0) return;
        const prev = items.slice();
        [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
        setListStatus('saving', '排序中…');
        // 经 coordinator：并发的 edit 若在途，reorder 会排在 edit 之后
        coordinator(() => opts.onReorder(items.map((x) => x.id)), 'reorder-up');
      } } }, '↑');
      const moveDown = h('button', { class: 'icon-btn', title: '下移', on: { click: () => {
        if (idx >= items.length - 1) return;
        const prev = items.slice();
        [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]];
        setListStatus('saving', '排序中…');
        coordinator(() => opts.onReorder(items.map((x) => x.id)), 'reorder-down');
      } } }, '↓');
      const del = h('button', { class: 'icon-btn icon-btn--danger', title: '删除', on: { click: () => {
        if (!globalThis.confirm(`确定删除该${opts.label || '条目'}吗？此操作不可撤销。`)) return;
        setListStatus('saving', '删除中…');
        // 经 coordinator：必须先完成在途的 edit，再执行 remove，最终 A 不存在
        coordinator(async () => {
          if (it.id) await opts.onRemove(it.id);
          items.splice(idx, 1);
          refresh();
        }, 'remove');
      } } }, '×');
      listEl.appendChild(h('div', { class: 'editable-row' }, [
        h('div', { class: 'editable-row__body' }, rowControls),
        h('div', { class: 'editable-row__actions' }, [moveUp, moveDown, del]),
      ]));
    });
  };
  refresh();
  const addBtn = h('button', { class: 'btn btn--sm', on: { click: () => {
    setListStatus('saving', '新增中…');
    // 经 coordinator：与并发的 edit 顺序入队
    coordinator(async () => {
      await opts.onAdd();
      const A = await aboutRepo.readAdmin();
      if (opts.onAfterAdd) opts.onAfterAdd(A);
    }, 'add');
  } } }, opts.addLabel || '+ 新增');
  return { el: h('div', {}, [listEl, addBtn, listStatus]), refresh, setItems: (ni) => { items = ni.slice(); refresh(); }, getItems: () => items };
}

function renderBody(A, isSupabase) {
  // —— #6 写状态机：dirty / saving / success / failure / unauthorized ——
  const statusBar = h('div', { class: 'form-status', 'aria-live': 'polite' });
  let isDirty = false;
  // —— #8/FINAL 真实保存队列（FIFO Promise queue）——
  // 所有结构化保存（Profile / ho7 / Education / Experience / Skill / Honor / Contact）
  // 统一经此 coordinator，绝不在途丢写；在途期间新的 blur/click 并入队，全部顺序执行。
  // 不同记录/不同模块的待保存任务互相不覆盖（不再用「只存最后一个 pending fn」的写法）。
  const saveQueue = [];
  let saveProcessing = false;
  let saveHadError = false;

  const markDirty = () => {
    if (!isDirty) { isDirty = true; statusBar.textContent = '未保存修改'; statusBar.className = 'form-status form-status--dirty'; }
  };
  const setSaving = (on) => {
    if (on) { statusBar.textContent = '保存中…'; statusBar.className = 'form-status form-status--saving'; }
  };
  const setStatus = (kind, msg) => {
    statusBar.textContent = msg;
    statusBar.className = `form-status form-status--${kind}`;
  };

  // 入队一个保存任务；若当前未在处理则立即开始泵队列。
  const enqueueSave = (fn, label) => {
    if (!auth.isAuthed()) { auth.logout && auth.logout(); location.hash = '#/admin/login'; return; }
    saveQueue.push({ fn, label });
    if (!saveProcessing) pumpSaveQueue();
  };

  // 顺序处理队列：A 在途时 B、C 入队 → A、B、C 最终全部执行；
  // 任一笔失败保留 failure 态但队列继续（会话失效除外，直接终止）；
  // 队列清空后 isDirty=false + 成功态（除非有失败）。
  const pumpSaveQueue = async () => {
    if (saveProcessing) return;
    if (saveQueue.length === 0) return;
    saveProcessing = true;
    saveHadError = false;
    setSaving(true);
    while (saveQueue.length > 0) {
      const task = saveQueue.shift();
      try {
        await task.fn();
      } catch (err) {
        saveHadError = true;
        if (/row-level security|is_admin|401|未授权|会话/.test(err.message || '')) {
          setStatus('unauthorized', '会话已失效或权限不足，请重新登录');
          toast('保存失败：权限不足，请重新登录');
          auth.logout && auth.logout();
          location.hash = '#/admin/login';
          saveProcessing = false;
          return;
        } else {
          setStatus('failure', `保存失败：${err.message || err}`);
          toast(`保存失败：${err.message || err}`);
        }
      }
    }
    saveProcessing = false;
    // #3 修复：存在失败任务时，不得宣称数据已干净 —— 保留 dirty + failure，
    // 仅成功队列才清 dirty + 成功态。用户可重试（重试任务再次入队）。
    if (saveHadError) {
      isDirty = true;
      setStatus('failure', '部分保存失败，修改未全部写入（可重试）');
    } else {
      isDirty = false;
      setStatus('success', '已保存');
    }
  };

  // blurSave 统一走 coordinator（不再用 single pendingSave，杜绝静默丢写）
  const blurSave = (fn) => enqueueSave(fn, 'blur');

  // —— profile 区（姓名 / 拼音 / 简介 / 创作方向）——
  const fullNameI = input(A.fullName, '姓名');
  const pinyinI = input(A.pinyin, '拼音');
  const bioT = textarea(A.bio, '简介');
  const dirT = textarea(A.creativeDirection || (A.directions || []).join(' / '), '创作方向（用 / 分隔）');
  // #三 修复：Profile 输入绑定 dirty（修改后显示「未保存修改」）
  [fullNameI, pinyinI, bioT, dirT].forEach((c) => c.el.addEventListener('input', markDirty));

  // 保存个人资料 → 经统一 coordinator（与 blurSave 同一队列，不绕开）
  const saveProfile = h('button', { class: 'btn btn--primary', on: { click: () => {
    enqueueSave(async () => {
      await aboutRepo.updateProfile({ fullName: fullNameI.get(), pinyin: pinyinI.get(), bio: bioT.get(), creativeDirection: dirT.get() });
    }, 'profile');
  } } }, '保存个人资料');

  // —— 教育经历 ——
  const eduEditor = makeListEditor({
    items: (A.education || []).map((e, i) => ({ ...e, id: e.id || `edu-${i}` })),
    label: '教育经历',
    addLabel: '+ 新增教育经历',
    coordinator: enqueueSave,
    renderRow: (e) => {
      const yr = input(e.yr, '年份/时段');
      const h1 = input(e.h, '标题/机构');
      const p1 = input(e.p, '详情');
      // 失焦即 upsert（仅对有 id 的条目）；#6 状态机 + 会话失效跳转
      const onBlur = async () => {
        await blurSave(() => aboutRepo.upsertEducation({ id: e.id, yr: yr.get(), h: h1.get(), p: p1.get() }));
      };
      [yr, h1, p1].forEach((c) => { c.el.addEventListener('blur', onBlur); c.el.addEventListener('input', markDirty); });
      return h('div', { class: 'editable-row__fields' }, [
        h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '时段'), yr.el]),
        h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '标题'), h1.el]),
        h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '详情'), p1.el]),
      ]);
    },
    onReorder: (ids) => aboutRepo.reorderEducation(ids),
    onRemove: (id) => aboutRepo.removeEducation(id),
    onAdd: () => aboutRepo.upsertEducation({ yr: '新时段', h: '新机构', p: '' }),
    onAfterAdd: (newA) => { eduEditor.setItems(newA.education.map((e, i) => ({ ...e, id: e.id || `edu-${i}` }))); },
  });

  // —— 经历 ——
  const expEditor = makeListEditor({
    items: (A.experience || []).map((e, i) => ({ ...e, id: e.id || `exp-${i}` })),
    label: '经历',
    addLabel: '+ 新增经历',
    coordinator: enqueueSave,
    renderRow: (e) => {
      const yr = input(e.yr, '年份/时段');
      const h1 = input(e.h, '标题');
      const p1 = input(e.p, '详情');
      const onBlur = async () => {
        await blurSave(() => aboutRepo.upsertExperience({ id: e.id, yr: yr.get(), h: h1.get(), p: p1.get() }));
      };
      [yr, h1, p1].forEach((c) => { c.el.addEventListener('blur', onBlur); c.el.addEventListener('input', markDirty); });
      return h('div', { class: 'editable-row__fields' }, [
        h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '时段'), yr.el]),
        h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '标题'), h1.el]),
        h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '详情'), p1.el]),
      ]);
    },
    onReorder: (ids) => aboutRepo.reorderExperience(ids),
    onRemove: (id) => aboutRepo.removeExperience(id),
    onAdd: () => aboutRepo.upsertExperience({ yr: '新时段', h: '新经历', p: '' }),
    onAfterAdd: (newA) => { expEditor.setItems(newA.experience.map((e, i) => ({ ...e, id: e.id || `exp-${i}` }))); },
  });

  // —— 技能 ——
  const skillEditor = makeListEditor({
    items: (A.skills || []).map((s, i) => ({ name: s.name, id: s.id || `sk-${i}` })),
    label: '技能',
    addLabel: '+ 新增技能',
    coordinator: enqueueSave,
    renderRow: (s) => {
      const nameI = input(s.name, '技能名称');
      const onBlur = async () => {
        await blurSave(() => aboutRepo.upsertSkill(nameI.get(), s.id));
      };
      nameI.el.addEventListener('blur', onBlur);
      nameI.el.addEventListener('input', markDirty);
      return h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '技能'), nameI.el]);
    },
    onReorder: (ids) => aboutRepo.reorderSkill(ids),
    onRemove: (id) => aboutRepo.removeSkill(id),
    onAdd: () => aboutRepo.upsertSkill('新技能'),
    onAfterAdd: (newA) => { skillEditor.setItems((newA.skills || []).map((s, i) => ({ name: s.name, id: s.id || `sk-${i}` }))); },
  });

  // —— 荣誉 ——
  const honorEditor = makeListEditor({
    items: (A.honors || []).map((a, i) => ({ y: a.y, t: a.t, id: a.id || `ho-${i}` })),
    label: '荣誉',
    addLabel: '+ 新增荣誉',
    coordinator: enqueueSave,
    renderRow: (a) => {
      const yI = input(a.y, '年份');
      const tI = input(a.t, '荣誉名称');
      const onBlur = async () => {
        await blurSave(() => aboutRepo.upsertHonor({ id: a.id, y: yI.get(), t: tI.get() }));
      };
      [yI, tI].forEach((c) => { c.el.addEventListener('blur', onBlur); c.el.addEventListener('input', markDirty); });
      return h('div', { class: 'editable-row__fields' }, [
        h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '年份'), yI.el]),
        h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '名称'), tI.el]),
      ]);
    },
    onReorder: (ids) => aboutRepo.reorderHonor(ids),
    onRemove: (id) => aboutRepo.removeHonor(id),
    onAdd: () => aboutRepo.upsertHonor({ y: '新年份', t: '新荣誉' }),
    onAfterAdd: (newA) => { honorEditor.setItems(newA.honors.map((a, i) => ({ ...a, id: a.id || `ho-${i}` }))); },
  });

  // —— 联系方式 ——
  const contactEditor = makeListEditor({
    items: (A.contacts || []).map((c, i) => ({ k: c.k, v: c.v, id: c.id || `ct-${i}` })),
    label: '联系方式',
    addLabel: '+ 新增联系方式',
    coordinator: enqueueSave,
    renderRow: (c) => {
      const kI = input(c.k, '标签');
      const vI = input(c.v, '链接');
      const onBlur = async () => {
        await blurSave(() => aboutRepo.upsertContact(kI.get(), vI.get(), c.id));
      };
      [kI, vI].forEach((cc) => { cc.el.addEventListener('blur', onBlur); cc.el.addEventListener('input', markDirty); });
      return h('div', { class: 'editable-row__fields' }, [
        h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '标签'), kI.el]),
        h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '链接'), vI.el]),
      ]);
    },
    onReorder: (ids) => aboutRepo.reorderContact(ids),
    onRemove: (id) => aboutRepo.removeContact(id),
    onAdd: () => aboutRepo.upsertContact('新标签', ''),
    onAfterAdd: (newA) => { contactEditor.setItems((newA.contacts || []).map((c, i) => ({ ...c, id: c.id || `ct-${i}` }))); },
  });

  // —— 荣誉叙述段（ho7）：独立可编辑文本入口（#7 修复）——
  // 不进入普通荣誉 reorder/delete；仅提供独立文本编辑，写回 honors 表 ho7 行。
  const ho7Text = input(A.honorParagraph || '', '荣誉叙述段（如：2004–2011 连续8届…）');
  // ho7 保存 → 经统一 coordinator（与 blurSave / Profile 同一队列）
  const saveHo7 = h('button', { class: 'btn btn--primary', on: { click: () => {
    enqueueSave(async () => {
      await aboutRepo.upsertHonor({ id: 'ho7', t: ho7Text.get(), y: '2004-2011' });
    }, 'ho7');
  } } }, '保存荣誉叙述段');
  ho7Text.el.addEventListener('input', markDirty);

  const children = [
    h('div', { class: 'about-edit-section' }, [
      h('h3', {}, '个人资料'),
      field('姓名', fullNameI.el),
      field('拼音', pinyinI.el),
      field('简介', bioT.el),
      field('创作方向', dirT.el),
      saveProfile,
      statusBar,
    ]),
    h('div', { class: 'about-edit-section' }, [h('h3', {}, `教育经历（${A.education.length}）`), eduEditor.el]),
    h('div', { class: 'about-edit-section' }, [h('h3', {}, `经历（${A.experience.length}）`), expEditor.el]),
    h('div', { class: 'about-edit-section' }, [h('h3', {}, '技能'), skillEditor.el]),
    h('div', { class: 'about-edit-section' }, [h('h3', {}, `荣誉（${A.honors.length}）`), honorEditor.el]),
    // #7 修复：ho7 叙述段独立编辑入口（不进普通荣誉集合）
    (A.honorParagraph ? h('div', { class: 'about-edit-section' }, [
      h('h3', {}, '荣誉（续 · 叙述段 / ho7）'),
      field('叙述文本', ho7Text.el),
      saveHo7,
      h('p', { class: 'secondary' }, '此段为连续叙述（如「2004–2011 连续8届…」），独立于上方普通荣誉，不参与其排序/删除。'),
    ]) : null),
    h('div', { class: 'about-edit-section' }, [h('h3', {}, '联系方式'), contactEditor.el]),
  ];
  return h('div', { class: 'form' }, children);
}
