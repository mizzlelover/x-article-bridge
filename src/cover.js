function coverArea() {
  const editor = editorRoot();
  const candidates = [...document.querySelectorAll('div,section')].filter((element) => {
    if (element.closest('#xab-status-rail') || element.contains(editor) || editor?.contains(element)) return false;
    return /5:2/.test(element.textContent || '') && isVisibleElement(element);
  });
  const hint = candidates.at(-1);
  let area = hint;
  while (area && area !== document.body && !area.contains(editor)) {
    if (area.querySelector('input[type=file],button,[role=button]')) return area;
    area = area.parentElement;
  }
  return null;
}

async function uploadCover(file) {
  const area = coverArea();
  if (!area) throw new Error('找不到封面上传区域，请使用 X 顶部的封面按钮设置');
  const originalUrl = location.href;
  const bitmap = await createImageBitmap(file);
  bitmap.close();
  let input = area.querySelector('input[type=file]');
  if (!input) {
    const before = new Set(document.querySelectorAll('input[type=file]'));
    const button = area.querySelector('button,[role=button]');
    if (!button) throw new Error('找不到封面选择按钮');
    button.click();
    input = await waitForUi(() => {
      const created = [...document.querySelectorAll('input[type=file]')].filter((item) => !before.has(item));
      return created.length === 1 ? created[0] : null;
    }, '找不到封面文件入口，请取消弹窗后使用 X 封面按钮');
  }
  if (location.href !== originalUrl) throw new Error('文章已切换，封面未上传');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', {bubbles:true}));
}

function offerCover(images) {
  document.getElementById('xab-cover-options')?.remove();
  const articleUrl = location.href;
  const panel = document.createElement('div');
  panel.id = 'xab-cover-options';
  const heading = document.createElement('strong');
  heading.textContent = '封面（可选）';
  const select = document.createElement('select');
  select.setAttribute('aria-label', '选择正文图片作为封面');
  const empty = new Option('从正文图片中选择', '');
  select.append(empty);
  images.forEach((file, index) => select.append(new Option(`${index + 1}. ${file.name}`, String(index))));
  const label = document.createElement('label');
  label.textContent = '或上传另一张图片';
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/*';
  label.append(picker);
  const preview = document.createElement('img');
  preview.alt = '所选封面预览';
  preview.hidden = true;
  const submit = document.createElement('button');
  submit.textContent = '上传为封面';
  submit.disabled = true;
  const detail = document.createElement('span');
  detail.textContent = '正文已完成。封面上传后，请在 X 中确认裁剪和保存。';
  let chosen = null;
  let previewUrl = null;
  const choose = (file) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    chosen = file;
    submit.disabled = !file;
    preview.hidden = !file;
    if (file) { previewUrl = URL.createObjectURL(file); preview.src = previewUrl; }
  };
  select.addEventListener('change', () => { picker.value = ''; choose(select.value === '' ? null : images[Number(select.value)]); });
  picker.addEventListener('change', () => { select.value = ''; choose(picker.files[0] || null); });
  submit.addEventListener('click', async () => {
    if (!chosen || submit.disabled) return;
    submit.disabled = true;
    select.disabled = picker.disabled = true;
    let token;
    try {
      if (location.href !== articleUrl) throw new Error('文章已切换，请在当前文章重新设置封面');
      token = importGate.begin();
      await uploadCover(chosen);
      detail.textContent = '封面文件已交给 X。请在 X 中确认裁剪，并检查封面预览；正文无需重新导入。';
    } catch (error) {
      detail.textContent = `封面未完成：${error.message}。正文已保留。`;
    } finally {
      if (token) importGate.end(token);
    }
  });
  panel.append(heading, select, label, preview, submit, detail);
  document.getElementById(STATUS_ID).append(panel);
}
