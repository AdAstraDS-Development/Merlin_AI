import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/icon';
import { Skeleton } from '../components/status';
import { ApiError, describeError } from '../lib/api-client';
import { factoryApi, queryKeys } from '../lib/factory-api';
import { announce, money, randomSuffix, safeUrl } from '../lib/format';
import type {
  CostEstimate,
  FactoryInfo,
  PreviewResult,
  RunMode,
} from '../lib/factory-types';
import {
  ADMIN_FIELDS,
  EXAMPLE,
  MAX_DESCRIPTION,
  MAX_FILE,
  OUTLINE,
  RX,
  STEPS,
  SUBS,
  TEXT_ACCEPT,
  TEXT_FILE,
  USER_HINTS,
  blankDraft,
  bulletLines,
  clearDraft,
  fieldKey,
  fitSlug,
  loadDraft,
  rememberCostCenter,
  requestBody,
  saveDraft,
  stepFor,
  storageRoom,
  stripBullet,
  toPascal,
  toSlug,
  validateStep,
  type Draft,
  type Errors,
} from '../lib/wizard';

/** Control id of a wizard field, also the target when an error is focused. */
const fid = (path: string): string => `f-${path.replace(/\W+/g, '-')}`;
const describedBy = (path: string, hint?: unknown): string =>
  [hint ? `${fid(path)}-hint` : '', `${fid(path)}-err`]
    .filter(Boolean)
    .join(' ');

interface StepProps {
  draft: Draft;
  info: FactoryInfo;
  errors: Errors;
  edit: (fn: (d: Draft) => void) => void;
  setError: (path: string, message: string | null) => void;
}

export function NewAppView({
  info,
  navigate,
}: {
  info: FactoryInfo;
  navigate: (hash: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => loadDraft(info));
  const step = Math.min(draft.step, STEPS.length - 1);
  const [maxStep, setMaxStep] = useState(step);
  const [errors, setErrors] = useState<Errors>({});
  const [adminOpen, setAdminOpen] = useState(false);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [prefilled, setPrefilled] = useState(false);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(() =>
    step === 0 ? { id: fid('appName'), n: 0 } : null,
  );

  useEffect(() => saveDraft(draft), [draft]);
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(focus.id);
    el?.closest('details')?.setAttribute('open', '');
    el?.focus();
  }, [focus]);
  useEffect(() => {
    // A file dropped next to the drop zone would otherwise replace the page.
    const block = (e: globalThis.DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  const edit = (fn: (d: Draft) => void): void =>
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  const setError = (path: string, message: string | null): void =>
    setErrors((e) => {
      const n = { ...e };
      if (message) n[path] = message;
      else delete n[path];
      return n;
    });
  const focusOn = (id: string): void =>
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));

  /** Shows a step; with errors, focuses the first invalid field. */
  function go(i: number, moveFocus = true, stepErrors: Errors = {}): void {
    const seeding =
      i === 1 && !draft.useCasesSeeded && draft.useCases.length === 0;
    // Use cases start from the lists in the description, so most people only edit.
    const fromText = seeding
      ? bulletLines(draft.description).filter((l) => l.length <= 300)
      : [];
    if (i === 1) setPrefilled(fromText.length > 0);
    edit((d) => {
      d.step = i;
      if (i === 1) {
        if (fromText.length) d.useCases.push(...fromText.slice(0, 50));
        d.useCasesSeeded = true;
      }
    });
    setDir(i >= step ? 'fwd' : 'back');
    setMaxStep((m) => Math.max(m, i));
    setErrors(stepErrors);
    const first = Object.keys(stepErrors)[0];
    if (first) focusOn(fid(first));
    else if (moveFocus) focusOn(i === 0 ? fid('appName') : 'step-title');
    announce(`Step ${i + 1} of ${STEPS.length}: ${STEPS[i]}`);
  }
  function next(): void {
    const e = validateStep(draft, info, step);
    if (
      step === 2 &&
      info.isAdmin &&
      Object.keys(e).some((k) => ADMIN_FIELDS.includes(k))
    )
      setAdminOpen(true);
    if (Object.keys(e).length) {
      setErrors(e);
      focusOn(fid(Object.keys(e)[0]));
      return;
    }
    go(step + 1);
  }
  function jump(target: number): void {
    for (let k = Math.min(step, target); k < target; k++) {
      const e = validateStep(draft, info, k);
      if (Object.keys(e).length) return go(k, false, e);
    }
    go(target);
  }
  function startOver(): void {
    setDraft(blankDraft(info));
    setMaxStep(0);
    go(0);
  }

  const ctx: StepProps = { draft, info, errors, edit, setError };
  const last = step === STEPS.length - 1;
  const nav = (start: ReactNode): JSX.Element => (
    <div className="form-nav">
      {step > 0 ? (
        <button
          type="button"
          className="btn ghost"
          onClick={() => go(step - 1)}
        >
          Back
        </button>
      ) : (
        <button type="button" className="btn ghost" onClick={startOver}>
          Start over
        </button>
      )}
      {last ? (
        <span className="nav-start">{start}</span>
      ) : (
        <button type="submit" className="btn primary">
          Continue
          <Icon name="arrow" size={16} />
        </button>
      )}
    </div>
  );

  let body: ReactNode;
  if (step === 0)
    body = (
      <IdeaStep
        ctx={ctx}
        onExample={() => {
          edit((d) =>
            Object.assign(d, {
              ...EXAMPLE,
              users: [...EXAMPLE.users],
              appName: toPascal(EXAMPLE.text),
              slug: toSlug(EXAMPLE.text),
              repo: toSlug(EXAMPLE.text),
              slugDirty: false,
              repoDirty: false,
            }),
          );
          go(0);
        }}
      />
    );
  else if (step === 1) body = <DetailsStep ctx={ctx} prefilled={prefilled} />;
  else if (step === 2)
    body = (
      <WhereStep
        ctx={ctx}
        adminOpen={adminOpen}
        onAdmin={() => setAdminOpen((o) => !o)}
      />
    );

  return (
    <section className="container wizard">
      <h1 className="sr-only">New application</h1>
      <div className="wizard-top">
        <div className="step-head">
          <h2 id="step-title" tabIndex={-1}>
            {STEPS[step]}
          </h2>
          {SUBS[step] && <p className="muted small">{SUBS[step]}</p>}
        </div>
        <nav className="stepper-wrap" aria-label="Steps">
          <span
            className="stepper-progress"
            aria-hidden="true"
            style={{ ['--p' as string]: String((step + 1) / STEPS.length) }}
          />
          <ol className="stepper">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={i === step ? 'current' : i < step ? 'done' : ''}
              >
                <button
                  type="button"
                  disabled={i > maxStep}
                  aria-current={i === step ? 'step' : undefined}
                  aria-label={`Step ${i + 1}: ${s}${i < step ? ', done' : ''}`}
                  onClick={() => jump(i)}
                >
                  <span className="step-num">
                    {i < step ? <Icon name="check" size={14} /> : i + 1}
                  </span>
                  <span className="step-label">{s}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>
      <div className={`wizard-panel ${dir}`}>
        <form
          key={step}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!last) next();
          }}
        >
          {last ? (
            <ReviewStep
              ctx={ctx}
              nav={nav}
              onFix={(target, mapped) => go(target, false, mapped)}
              onStarted={(runId, mode) => {
                if (mode !== 'DryRun') clearDraft();
                navigate(`#/run/${runId}`);
              }}
            />
          ) : (
            <>
              {body}
              {nav(null)}
            </>
          )}
        </form>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- field helpers

function Field({
  path,
  label,
  hint,
  optional,
  error,
  children,
  after,
}: {
  path: string;
  label: string;
  hint?: string;
  optional?: boolean;
  error?: string;
  children: ReactNode;
  after?: ReactNode;
}): JSX.Element {
  const id = fid(path);
  return (
    <div className={`field${error ? ' invalid editing' : ''}`} data-path={path}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="opt"> optional</span>}
      </label>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p className="field-error" id={`${id}-err`}>
          {error}
        </p>
      )}
      {after}
    </div>
  );
}

const Cols = ({
  cls = '',
  left,
  right,
}: {
  cls?: string;
  left: ReactNode;
  right: ReactNode;
}): JSX.Element => (
  <div className={`wizard-cols ${cls}`}>
    <div className="wizard-col">{left}</div>
    <div className="wizard-col">{right}</div>
  </div>
);

/** Entries as removable chips; Enter or paste of several lines adds them. Optional one-click suggestions. */
function ChipList({
  path,
  label,
  values,
  onChange,
  error,
  onError,
  hint,
  placeholder,
  max,
  validate,
  suggest = [],
  optional = true,
}: {
  path: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  error?: string;
  onError: (message: string | null) => void;
  hint?: string;
  placeholder?: string;
  max: number;
  validate?: (v: string) => string | null;
  suggest?: string[];
  optional?: boolean;
}): JSX.Element {
  const [box, setBox] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const addValues = (parts: string[]): boolean => {
    const next = [...values];
    for (const p of parts) {
      const bad = validate?.(p);
      if (bad) {
        onError(bad);
        return false;
      }
      if (next.length >= max) {
        onError(`At most ${max} entries.`);
        return false;
      }
      if (!next.includes(p)) next.push(p);
    }
    onError(null);
    onChange(next);
    return true;
  };
  const add = (): void => {
    if (
      addValues(
        box
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
    )
      setBox('');
  };
  const shown = suggest.filter((x) => !values.includes(x)).slice(0, 8);
  return (
    <Field
      path={path}
      label={label}
      hint={hint}
      optional={optional}
      error={error}
      after={
        <div
          className="suggest"
          hidden={shown.length === 0 || values.length >= max}
        >
          {shown.map((x) => (
            <button
              key={x}
              type="button"
              className="chip-btn"
              onClick={() => addValues([x])}
            >
              <Icon name="plus" size={14} />
              {x}
            </button>
          ))}
        </div>
      }
    >
      <ul className="chip-list" role="list">
        {values.map((v, i) => (
          <li key={v} className="chip">
            <span>{v}</span>
            <button
              type="button"
              className="chip-x"
              aria-label={`Remove ${v}`}
              onClick={() => {
                onChange(values.filter((_, k) => k !== i));
                input.current?.focus();
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <input
        ref={input}
        id={fid(path)}
        type="text"
        className="input"
        placeholder={placeholder}
        autoComplete="off"
        maxLength={300}
        aria-describedby={describedBy(path, hint)}
        aria-invalid={error ? true : undefined}
        value={box}
        onChange={(e) => setBox(e.target.value)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onPaste={(e: ClipboardEvent) => {
          const text = e.clipboardData?.getData('text') ?? '';
          if (!/\r?\n/.test(text.trim())) return;
          e.preventDefault();
          addValues(text.split(/\r?\n/).map(stripBullet).filter(Boolean));
        }}
        onBlur={() => box.trim() && add()}
      />
    </Field>
  );
}

/** A textarea that holds one entry per line and keeps the draft list in sync. */
function Lines({
  path,
  values,
  onChange,
  hint,
  rows,
  placeholder,
  error,
}: {
  path: string;
  values: string[];
  onChange: (values: string[]) => void;
  hint?: string;
  rows: number;
  placeholder: string;
  error?: string;
}): JSX.Element {
  const [text, setText] = useState(() => values.join('\n'));
  return (
    <textarea
      id={fid(path)}
      className="input"
      rows={rows}
      placeholder={placeholder}
      aria-describedby={describedBy(path, hint)}
      aria-invalid={error ? true : undefined}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split('\n').map(stripBullet).filter(Boolean));
      }}
    />
  );
}

// ---------------------------------------------------------------- step 1: idea

function IdeaStep({
  ctx,
  onExample,
}: {
  ctx: StepProps;
  onExample: () => void;
}): JSX.Element {
  const { draft: d, info, errors, edit, setError } = ctx;
  const [slugEditing, setSlugEditing] = useState(false);
  const [dropMsg, setDropMsg] = useState<{
    text: string;
    warn: boolean;
  } | null>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const desc = useRef<HTMLTextAreaElement>(null);
  const slugIn = useRef<HTMLInputElement>(null);

  const syncRepo = (x: Draft): void => {
    if (!x.repoDirty || !info.isAdmin) x.repo = x.slug;
  };
  const slugErr = errors.appSlug;
  const len = d.description.length;
  const empty = !d.text.trim() && !d.description.trim();

  async function takeFiles(files: File[]): Promise<void> {
    const added: string[] = [];
    const skipped: string[] = [];
    let text = d.description;
    for (const f of files) {
      if (!TEXT_FILE.test(f.name)) {
        skipped.push(`${f.name} (not a text file)`);
        continue;
      }
      if (f.size > MAX_FILE) {
        skipped.push(`${f.name} (larger than 200 KB)`);
        continue;
      }
      const content = (await f.text()).replace(/\r\n?/g, '\n').trim();
      const block = `## From ${f.name}\n\n${content}`;
      if ((text + block).length + 2 > MAX_DESCRIPTION) {
        skipped.push(
          `${f.name} (description would exceed ${MAX_DESCRIPTION.toLocaleString()} characters)`,
        );
        continue;
      }
      text = text.trim() ? `${text.trim()}\n\n${block}` : block;
      added.push(f.name);
    }
    if (added.length) edit((x) => (x.description = text));
    setDropMsg({
      warn: skipped.length > 0,
      text: [
        added.length ? `Added ${added.join(', ')}.` : '',
        skipped.length
          ? `Skipped ${skipped.join(', ')}. For Word, PDF or PowerPoint, paste the text or add a link below.`
          : '',
      ]
        .join(' ')
        .trim(),
    });
  }
  const hasFiles = (e: DragEvent): boolean =>
    !!e.dataTransfer?.types.includes('Files');

  return (
    <Cols
      cls="wide-right"
      left={
        <>
          <Field
            path="appName"
            label="What is the app called?"
            error={errors.appName}
            after={
              <div
                className={`slug-line${slugEditing || slugErr ? ' editing' : ''}${slugErr ? ' invalid' : ''}`}
              >
                <span className="muted small">Identifier</span>
                <code className="mono-chip">{d.slug || '-'}</code>
                <button
                  type="button"
                  className="linklike"
                  onClick={() => {
                    setSlugEditing(true);
                    requestAnimationFrame(() => slugIn.current?.focus());
                  }}
                >
                  Change
                </button>
                <input
                  ref={slugIn}
                  id={fid('appSlug')}
                  type="text"
                  className="input"
                  maxLength={25}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Identifier"
                  aria-describedby={`${fid('appSlug')}-err`}
                  aria-invalid={slugErr ? true : undefined}
                  value={d.slug}
                  onChange={(e) =>
                    edit((x) => {
                      x.slug = e.target.value;
                      x.slugDirty = true;
                      syncRepo(x);
                    })
                  }
                />
                {slugErr && (
                  <p className="field-error" id={`${fid('appSlug')}-err`}>
                    {slugErr}
                  </p>
                )}
              </div>
            }
          >
            <input
              id={fid('appName')}
              type="text"
              className="input xl"
              maxLength={60}
              placeholder="For example: Fleet Portal"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={describedBy('appName')}
              aria-invalid={errors.appName ? true : undefined}
              value={d.text}
              onChange={(e) => {
                const v = e.target.value;
                edit((x) => {
                  x.text = v;
                  x.appName = toPascal(v);
                  if (!x.slugDirty)
                    x.slug = fitSlug(toSlug(v), storageRoom(x, info));
                  syncRepo(x);
                });
              }}
            />
          </Field>
          <Field
            path="problem"
            label="What problem does it solve?"
            optional
            error={errors.problem}
          >
            <input
              id={fid('problem')}
              type="text"
              className="input"
              maxLength={300}
              autoComplete="off"
              placeholder="One sentence, for example: Dispatchers find double bookings too late."
              aria-describedby={describedBy('problem')}
              value={d.problem}
              onChange={(e) => edit((x) => (x.problem = e.target.value))}
            />
          </Field>
          <ChipList
            path="documentLinks"
            label="Links to existing documents"
            values={d.documentLinks}
            onChange={(v) => edit((x) => (x.documentLinks = v))}
            error={errors.documentLinks}
            onError={(m) => setError('documentLinks', m)}
            placeholder="https://... (SharePoint, wiki, Figma)"
            max={20}
            validate={(v) =>
              RX.link.test(v) ? null : 'Links must start with https://'
            }
          />
          {empty && (
            <p className="small">
              <button type="button" className="linklike" onClick={onExample}>
                Fill in an example
              </button>
            </p>
          )}
        </>
      }
      right={
        <>
          <Field
            path="description"
            label="Tell us everything about it"
            hint="The more you write, the better the first spec."
            optional
            error={errors.description}
          >
            <div
              className={`dropzone${over ? ' over' : ''}`}
              onDragEnter={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                depth.current++;
                setOver(true);
              }}
              onDragOver={(e) => hasFiles(e) && e.preventDefault()}
              onDragLeave={() => {
                if (--depth.current <= 0) {
                  depth.current = 0;
                  setOver(false);
                }
              }}
              onDrop={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                depth.current = 0;
                setOver(false);
                void takeFiles([...e.dataTransfer.files]);
              }}
            >
              <textarea
                ref={desc}
                id={fid('description')}
                className="input"
                rows={12}
                maxLength={MAX_DESCRIPTION}
                placeholder="How is it done today, who uses it, what must they be able to do, which rules and systems matter. Paste notes, mails or meeting minutes."
                aria-describedby={describedBy('description', true)}
                aria-invalid={errors.description ? true : undefined}
                value={d.description}
                onChange={(e) => edit((x) => (x.description = e.target.value))}
              />
              <div className="drop-bar">
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => picker.current?.click()}
                >
                  <Icon name="plus" size={14} />
                  Add text files
                </button>
                <span className="muted small">
                  or drop .md, .txt, .csv here
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={!!d.description.trim()}
                  onClick={() => {
                    edit((x) => (x.description = OUTLINE));
                    desc.current?.focus();
                  }}
                >
                  Use an outline
                </button>
                <span
                  className={`muted small tabular${len > MAX_DESCRIPTION * 0.95 ? ' over' : ''}`}
                >
                  {len.toLocaleString()} / {MAX_DESCRIPTION.toLocaleString()}
                </span>
              </div>
              <div className="drop-overlay" aria-hidden="true">
                <Icon name="plus" size={28} />
                Drop to add the text
              </div>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                accept={TEXT_ACCEPT}
                onChange={(e) => {
                  void takeFiles([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
            </div>
          </Field>
          <p
            className={`drop-msg small${dropMsg?.warn ? ' warn' : ''}`}
            role="status"
          >
            {dropMsg?.text}
          </p>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------- step 2: users and use cases

const isHint = (x: string): boolean =>
  USER_HINTS.some((u) => u.toLowerCase() === x.toLowerCase());

function DetailsStep({
  ctx,
  prefilled,
}: {
  ctx: StepProps;
  prefilled: boolean;
}): JSX.Element {
  const { draft: d, errors, edit } = ctx;
  const [others, setOthers] = useState(() =>
    d.users.filter((u) => !isHint(u)).join(', '),
  );
  const [moreOpen] = useState(() => !!(d.outcome || d.constraints.length));
  const useCasesHint = prefilled
    ? 'Taken from your description. Edit freely, one per line.'
    : 'One per line. Leave empty and the agent asks later.';
  return (
    <>
      <Cols
        left={
          <div
            className={`field${errors.users ? ' invalid editing' : ''}`}
            data-path="users"
            role="group"
            aria-labelledby="users-label"
          >
            <label htmlFor={fid('users')} id="users-label">
              Who uses it?
            </label>
            <div
              className="pick-row"
              role="group"
              aria-label="Common user groups"
            >
              {USER_HINTS.map((u) => (
                <button
                  key={u}
                  type="button"
                  className="chip-btn"
                  aria-pressed={d.users.includes(u)}
                  onClick={() =>
                    edit((x) => {
                      x.users = x.users.includes(u)
                        ? x.users.filter((v) => v !== u)
                        : [...x.users, u];
                    })
                  }
                >
                  {u}
                </button>
              ))}
            </div>
            <input
              id={fid('users')}
              type="text"
              className="input"
              maxLength={300}
              autoComplete="off"
              placeholder="Others, separated by commas"
              aria-describedby={`${fid('users')}-err`}
              value={others}
              onChange={(e) => {
                setOthers(e.target.value);
                const typed = e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean);
                const picked = typed
                  .filter(isHint)
                  .map((x) =>
                    USER_HINTS.find(
                      (u) => u.toLowerCase() === x.toLowerCase(),
                    )!,
                  );
                const rest = typed.filter((x) => !isHint(x));
                edit((x) => {
                  const keep = x.users.filter((u) => USER_HINTS.includes(u));
                  x.users = [
                    ...new Set([...keep, ...picked]),
                    ...new Map(rest.map((r) => [r.toLowerCase(), r])).values(),
                  ];
                });
              }}
            />
            {errors.users && (
              <p className="field-error" id={`${fid('users')}-err`}>
                {errors.users}
              </p>
            )}
          </div>
        }
        right={
          <Field
            path="useCases"
            label="What should they be able to do?"
            hint={useCasesHint}
            error={errors.useCases}
          >
            <Lines
              path="useCases"
              values={d.useCases}
              onChange={(v) => edit((x) => (x.useCases = v))}
              hint={useCasesHint}
              rows={8}
              error={errors.useCases}
              placeholder={
                "One per line, for example:\nDispatcher assigns a vehicle to a trip\nDriver sees today's trips"
              }
            />
          </Field>
        }
      />
      <details className="advanced" open={moreOpen}>
        <summary>More details (optional)</summary>
        <div className="grid-2">
          <Field
            path="outcome"
            label="What does success look like?"
            error={errors.outcome}
          >
            <input
              id={fid('outcome')}
              type="text"
              className="input"
              maxLength={300}
              autoComplete="off"
              placeholder="For example: No more double bookings."
              aria-describedby={describedBy('outcome')}
              value={d.outcome}
              onChange={(e) => edit((x) => (x.outcome = e.target.value))}
            />
          </Field>
          <Field
            path="constraints"
            label="Rules and constraints"
            error={errors.constraints}
          >
            <Lines
              path="constraints"
              values={d.constraints}
              onChange={(v) => edit((x) => (x.constraints = v))}
              rows={3}
              error={errors.constraints}
              placeholder="One per line, for example: Data stays in the EU"
            />
          </Field>
        </div>
      </details>
    </>
  );
}

// ---------------------------------------------------------------- step 3: where

function Choice({
  path,
  label,
  value,
  options,
  error,
  onChange,
}: {
  path: string;
  label: string;
  value: string;
  options: [string, string][];
  error?: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <Field path={path} label={label} error={error}>
      {options.length === 1 ? (
        <output
          id={fid(path)}
          className="fixed"
          title="Set by the platform team"
        >
          {options[0][1]}
        </output>
      ) : (
        <select
          id={fid(path)}
          className="input"
          value={value}
          aria-describedby={describedBy(path)}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function WhereStep({
  ctx,
  adminOpen,
  onAdmin,
}: {
  ctx: StepProps;
  adminOpen: boolean;
  onAdmin: () => void;
}): JSX.Element {
  const { draft: d, info, errors, edit, setError } = ctx;
  const b = info.billing;
  const free = !!b?.free;
  const tier = b?.tiers.find((t) => t.id === d.billing?.tier);
  const noProduction = tier?.production === false;
  const sub = info.subscriptions.find((x) => x.id === d.azure.subscriptionId);

  const toggle = (
    key: 'protectMain' | 'runLocalValidation',
    title: string,
    text: string,
  ): JSX.Element => (
    <label className="check-row">
      <input
        type="checkbox"
        checked={d.github[key]}
        onChange={(e) => edit((x) => (x.github[key] = e.target.checked))}
      />
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
    </label>
  );
  const store = (v: string, label: string, small?: string): JSX.Element => (
    <label className="radio-pill">
      <input
        type="radio"
        name="db"
        value={v}
        checked={d.database === v}
        onChange={() => edit((x) => (x.database = v))}
      />
      <span>
        {label}
        {small && <small> {small}</small>}
      </span>
    </label>
  );
  const visibility = (v: string, label: string): JSX.Element => (
    <label className="radio-pill">
      <input
        type="radio"
        name="vis"
        value={v}
        checked={d.github.visibility === v}
        onChange={() => edit((x) => (x.github.visibility = v))}
      />
      {label}
    </label>
  );

  const left = (
    <>
      {/* Where it runs is set by the platform team; only platform admins may change it. */}
      <div className="runs-in card">
        <div className="runs-in-head">
          <Icon name="lock" size={16} />
          <strong>Runs in</strong>
          <span className="muted small">Set by the platform team</span>
        </div>
        <dl className="kv compact">
          <dt>Subscription</dt>
          <dd>{sub ? sub.name : d.azure.subscriptionId}</dd>
          <dt>Region</dt>
          <dd>{d.azure.region}</dd>
          <dt>Repository</dt>
          <dd className="mono">{`${info.githubHost}/${d.github.owner}/${d.repo}`}</dd>
          <dt>Visibility</dt>
          <dd>
            {d.github.visibility === 'internal' ? 'Internal' : 'Private'}
            {d.github.protectMain ? ', main protected' : ''}
          </dd>
        </dl>
        {info.isAdmin && (
          <button
            type="button"
            className="btn small"
            aria-expanded={adminOpen}
            onClick={onAdmin}
          >
            {adminOpen ? 'Done' : 'Change (admin)'}
          </button>
        )}
      </div>
      {info.isAdmin && adminOpen && (
        <div className="admin-box">
          <div className="grid-2">
            <Choice
              path="tenantId"
              label="Azure tenant"
              value={d.azure.tenantId}
              error={errors.tenantId}
              options={info.tenants.map((t) => [t, t])}
              onChange={(v) => edit((x) => (x.azure.tenantId = v))}
            />
            <Choice
              path="subscriptionId"
              label="Subscription"
              value={d.azure.subscriptionId}
              error={errors.subscriptionId}
              options={info.subscriptions.map((x) => [x.id, x.name])}
              onChange={(v) => edit((x) => (x.azure.subscriptionId = v))}
            />
            <Choice
              path="region"
              label="Region"
              value={d.azure.region}
              error={errors.region}
              options={info.regions.map((r) => [r, r])}
              onChange={(v) => edit((x) => (x.azure.region = v))}
            />
            <Choice
              path="owner"
              label="GitHub organization"
              value={d.github.owner}
              error={errors.owner}
              options={info.allowedOwners.map((o) => [o, o])}
              onChange={(v) => edit((x) => (x.github.owner = v))}
            />
            <Field
              path="repoName"
              label="Repository name"
              error={errors.repoName}
            >
              <input
                id={fid('repoName')}
                type="text"
                className="input"
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={describedBy('repoName')}
                value={d.repo}
                onChange={(e) =>
                  edit((x) => {
                    x.repo = e.target.value;
                    x.repoDirty = true;
                  })
                }
              />
            </Field>
            <Field
              path="nameSuffix"
              label="Name suffix"
              error={errors.nameSuffix}
            >
              <div className="input-group">
                <input
                  id={fid('nameSuffix')}
                  type="text"
                  className="input"
                  maxLength={8}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={describedBy('nameSuffix')}
                  value={d.azure.nameSuffix}
                  onChange={(e) =>
                    edit((x) => (x.azure.nameSuffix = e.target.value))
                  }
                />
                <button
                  type="button"
                  className="btn"
                  aria-label="New random suffix"
                  onClick={() => {
                    const s = randomSuffix();
                    edit((x) => (x.azure.nameSuffix = s));
                    announce(`New suffix ${s}`);
                  }}
                >
                  <Icon name="refresh" size={16} />
                </button>
              </div>
            </Field>
          </div>
          <div className="radio-row">
            {visibility('private', 'Private')}
            {visibility('internal', 'Internal')}
          </div>
          {toggle(
            'protectMain',
            'Protect main',
            'Changes need a pull request and passing checks.',
          )}
          {toggle(
            'runLocalValidation',
            'Validate before pushing',
            'Runs pnpm validate first. Slower.',
          )}
        </div>
      )}
      <fieldset className="fieldset env-row">
        <legend>Environments</legend>
        <label className="check-row">
          <input type="checkbox" checked disabled />
          <span>
            <strong>Development</strong>
            <small>Every merge to main.</small>
          </span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={d.azure.production}
            disabled={noProduction}
            onChange={(e) =>
              edit((x) => (x.azure.production = e.target.checked))
            }
          />
          <span>
            <strong>Production</strong>
            <small>
              {noProduction
                ? `Not in the ${tier?.name} tier.`
                : 'After approval.'}
            </small>
          </span>
        </label>
      </fieldset>
      {d.azure.production && (
        <ChipList
          path="reviewers"
          label="Who approves production releases?"
          values={d.github.reviewers}
          onChange={(v) => edit((x) => (x.github.reviewers = v))}
          error={errors.reviewers}
          onError={(m) => setError('reviewers', m)}
          placeholder="GitHub user name"
          max={6}
          optional={false}
          validate={(v) =>
            RX.reviewer.test(v) ? null : 'Use a GitHub user name.'
          }
        />
      )}
      <fieldset className="fieldset">
        <legend>Data storage</legend>
        <div className="radio-row">
          {store('none', 'None')}
          {info.databases.includes('azure-sql') &&
            store('azure-sql', 'Azure SQL', 'serverless')}
        </div>
      </fieldset>
    </>
  );

  const right = b && d.billing && (
    <>
      <fieldset className="fieldset">
        <legend>
          Tier
          {free && <span className="free-tag">Free for now</span>}
        </legend>
        {errors.tier && <p className="field-error">{errors.tier}</p>}
        <div className="tier-grid" role="radiogroup">
          {b.tiers.map((t, i) => (
            <label key={t.id} className="tier-card">
              <input
                id={i === 0 ? fid('tier') : undefined}
                type="radio"
                name="tier"
                value={t.id}
                checked={d.billing?.tier === t.id}
                onChange={() =>
                  edit((x) => {
                    if (x.billing) x.billing.tier = t.id;
                    if (t.production === false) x.azure.production = false;
                  })
                }
              />
              <strong>{t.name}</strong>
              {free ? (
                <span className="tier-price">
                  Free
                  <small>
                    {' '}
                    later ~{money(t.monthlyPerEnvironment, b.currency)} / env /
                    month
                  </small>
                </span>
              ) : (
                <span className="tier-price">
                  {money(t.monthlyPerEnvironment, b.currency)}
                  <small> per environment / month</small>
                </span>
              )}
              <small>{t.summary}</small>
            </label>
          ))}
        </div>
      </fieldset>
      {b.costCenters.length ? (
        <Choice
          path="costCenter"
          label="Cost center"
          value={d.billing.costCenter}
          error={errors.costCenter}
          options={b.costCenters.map((c) => [c.id, `${c.id} ${c.name}`])}
          onChange={(v) => edit((x) => x.billing && (x.billing.costCenter = v))}
        />
      ) : (
        <Field
          path="costCenter"
          label="Cost center"
          hint="Tagged on the Azure resources."
          error={errors.costCenter}
        >
          <input
            id={fid('costCenter')}
            type="text"
            className="input"
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            placeholder="For example: CC-4711"
            aria-describedby={describedBy('costCenter', true)}
            aria-invalid={errors.costCenter ? true : undefined}
            value={d.billing.costCenter}
            onChange={(e) => {
              const v = e.target.value;
              rememberCostCenter(v);
              edit((x) => x.billing && (x.billing.costCenter = v));
            }}
          />
        </Field>
      )}
    </>
  );

  return <Cols left={left} right={right} />;
}

// ---------------------------------------------------------------- step 4: review

const MODE: Record<RunMode, [string, string]> = {
  DryRun: ['Dry run', 'Creates nothing. Shows every command.'],
  Local: [
    'On this computer',
    'Creates real resources with your az and gh sign-in.',
  ],
  Factory: [
    'Through the factory',
    'Creates the GitHub repository from the template. Azure follows later.',
  ],
};

function ReviewStep({
  ctx,
  nav,
  onFix,
  onStarted,
}: {
  ctx: StepProps;
  nav: (start: ReactNode) => JSX.Element;
  onFix: (step: number, errors: Errors) => void;
  onStarted: (runId: string, mode: RunMode) => void;
}): JSX.Element {
  const { draft: d, info } = ctx;
  const body = requestBody(d, info);
  const preview = useQuery({
    queryKey: ['factory', 'preview', body],
    queryFn: () => factoryApi.preview(body),
    staleTime: 0,
    gcTime: 0,
  });

  if (preview.isPending)
    return (
      <>
        <div className="stack-lg" aria-busy="true">
          <Skeleton rows={4} />
        </div>
        {nav(null)}
      </>
    );
  if (preview.isError) {
    const e = preview.error;
    let content: ReactNode = (
      <div className="notice err" role="alert">
        <Icon name="warning" />
        <p>{e.message}</p>
      </div>
    );
    if (e instanceof ApiError && e.errors) {
      const all = e.errors;
      const mapped: Errors = {};
      for (const [p, m] of Object.entries(all))
        if (p) mapped[fieldKey(p)] ??= m.join(' ');
      const target = Math.min(...Object.keys(mapped).map(stepFor), 2);
      const locked =
        !info.isAdmin &&
        Object.keys(mapped).some((k) =>
          [...ADMIN_FIELDS, 'visibility', 'options'].includes(k),
        );
      content = (
        <div className="notice err" role="alert">
          <Icon name="warning" />
          <div>
            <ul>
              {Object.entries(all).map(([p, m]) => (
                <li key={p}>{`${p || 'Request'}: ${m.join(' ')}`}</li>
              ))}
            </ul>
            {locked ? (
              <button
                type="button"
                className="btn small"
                onClick={() => location.reload()}
              >
                Load the platform settings again
              </button>
            ) : (
              <button
                type="button"
                className="btn small"
                onClick={() => onFix(target, mapped)}
              >
                Fix it
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <>
        <div className="stack-lg">{content}</div>
        {nav(null)}
      </>
    );
  }
  return (
    <ReviewPane
      draft={d}
      info={info}
      preview={preview.data}
      nav={nav}
      onStarted={onStarted}
    />
  );
}

export function ReviewPane({
  draft: d,
  info,
  preview: pv,
  nav,
  onStarted,
}: {
  draft: Draft;
  info: FactoryInfo;
  preview: PreviewResult;
  nav: (start: ReactNode) => JSX.Element;
  onStarted: (runId: string, mode: RunMode) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<RunMode>('DryRun');
  const [typed, setTyped] = useState('');
  const [checking, setChecking] = useState(false);
  const [avail, setAvail] = useState<
    Record<string, { ok: boolean; reason: string | null; checked?: boolean }>
  >(() =>
    Object.fromEntries(
      info.modes.map((m) => [m.id, { ok: m.available, reason: m.reason }]),
    ),
  );
  const start = useMutation({
    mutationFn: () =>
      factoryApi.startRun({ request: pv.request, mode, confirmation: typed }),
    onSuccess: ({ runId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apps });
      onStarted(runId, mode);
    },
  });

  async function pick(id: RunMode): Promise<void> {
    setMode(id);
    setTyped('');
    if (id === 'DryRun' || avail[id]?.checked) return;
    setChecking(true);
    let next: { ok: boolean; reason: string | null; checked: boolean };
    try {
      const r = await factoryApi.modeCheck(id);
      next = { ok: r.available, reason: r.reason, checked: true };
    } catch (e) {
      next = { ok: false, reason: describeError(e), checked: true };
    }
    setAvail((a) => ({ ...a, [id]: next }));
    setChecking(false);
    if (!next.ok) setMode('DryRun');
  }

  const startBtn = (
    <button
      type="button"
      className="btn primary large"
      disabled={
        start.isPending ||
        checking ||
        !avail[mode]?.ok ||
        (mode !== 'DryRun' && typed !== d.slug)
      }
      onClick={() => start.mutate()}
    >
      <Icon name="play" size={16} />
      {mode === 'DryRun'
        ? 'Start dry run'
        : mode === 'Local'
          ? 'Create now'
          : 'Create repository'}
    </button>
  );

  const n = pv.names;
  const repo = safeUrl(n.repository.url);
  const created: [string, string][] = [
    ...n.resourceGroups.map((g): [string, string] => [
      'Resource group',
      g.name,
    ]),
    ['State storage', n.stateStorage.storageAccount],
    ...n.identities.map((i): [string, string] => ['Identity', i.name]),
    ...n.webApps.map((w): [string, string] => [
      `Web app (${w.environment})`,
      w.url.replace('https://', ''),
    ]),
    ...n.databases.map((x): [string, string] => [
      `${x.kind} (${x.environment})`,
      x.name,
    ]),
    ...n.githubEnvironments.map((e): [string, string] => [
      'GitHub environment',
      e.name,
    ]),
  ];
  const mono = (t: string): JSX.Element => <code className="mono">{t}</code>;

  return (
    <>
      <div className="wizard-cols">
        <div className="wizard-col">
          <div className="card summary">
            <div className="summary-head">
              <h3>{d.text.trim() || d.appName}</h3>
              <span className="muted mono small">{d.slug}</span>
            </div>
            <dl className="kv">
              <dt>Repository</dt>
              <dd>
                {repo ? (
                  <a href={repo} target="_blank" rel="noopener noreferrer">
                    {n.repository.fullName}
                  </a>
                ) : (
                  n.repository.fullName
                )}
              </dd>
              {n.webApps.map((w) => [
                <dt key={`k-${w.name}`}>
                  {w.environment === 'production'
                    ? 'Production URL'
                    : 'App URL'}
                </dt>,
                <dd key={`v-${w.name}`}>
                  {mono(w.url.replace('https://', ''))}
                </dd>,
              ])}
              <dt>Use cases</dt>
              <dd>
                {d.useCases.length
                  ? String(d.useCases.length)
                  : 'None yet, the agent will help'}
              </dd>
              <dt>Data storage</dt>
              <dd>
                {(
                  {
                    none: 'None',
                    'azure-sql': 'Azure SQL (serverless)',
                  } as Record<string, string>
                )[d.database] ?? 'None'}
              </dd>
              <dt>Description</dt>
              <dd>
                {d.description.trim()
                  ? `${d.description.trim().length.toLocaleString()} characters`
                  : 'None'}
              </dd>
            </dl>
            <details className="more">
              <summary>
                Everything that will be created ({created.length})
              </summary>
              <dl className="kv compact">
                {created.map(([k, v]) => [
                  <dt key={`k-${k}-${v}`}>{k}</dt>,
                  <dd key={`v-${k}-${v}`}>{mono(v)}</dd>,
                ])}
              </dl>
            </details>
          </div>
        </div>
        <div className="wizard-col">
          {pv.cost && (
            <div className="card">
              <CostBlock cost={pv.cost} />
            </div>
          )}
          <fieldset className="fieldset">
            <legend>How should it run?</legend>
            <div
              className="mode-grid"
              role="radiogroup"
              aria-label="How to run"
            >
              {(Object.keys(MODE) as RunMode[]).map((id) => {
                const a = avail[id];
                return (
                  <label
                    key={id}
                    className={`mode-card${mode === id ? ' selected' : ''}${a?.ok ? '' : ' disabled'}`}
                    title={a?.ok ? '' : (a?.reason ?? '')}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={id}
                      checked={mode === id}
                      disabled={!a?.ok}
                      onChange={() => void pick(id)}
                    />
                    <strong>{MODE[id][0]}</strong>
                    <small className={a?.ok ? '' : 'mode-reason'}>
                      {a?.ok
                        ? MODE[id][1]
                        : (a?.reason ?? 'Not set up on this computer.')}
                    </small>
                  </label>
                );
              })}
            </div>
            {checking ? (
              <p className="muted small">
                Checking the sign-in for {info.githubHost}...
              </p>
            ) : mode !== 'DryRun' ? (
              <div className="notice warn">
                <Icon name="warning" />
                <div>
                  <p>
                    {mode === 'Local'
                      ? 'This creates real resources with your own rights.'
                      : `This creates the repository ${n.repository.fullName} from the template.`}{' '}
                    Type {d.slug} to confirm.
                  </p>
                  <input
                    type="text"
                    className="input"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`Type ${d.slug} to confirm`}
                    placeholder={d.slug}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value.trim())}
                  />
                </div>
              </div>
            ) : null}
          </fieldset>
          {start.isError && (
            <div className="notice err" role="alert">
              <Icon name="warning" />
              <p>{describeError(start.error)}</p>
            </div>
          )}
        </div>
      </div>
      {nav(startBtn)}
    </>
  );
}

function CostBlock({ cost: c }: { cost: CostEstimate }): JSX.Element {
  const m = (v: number): string => money(v, c.currency);
  return (
    <div className="cost-est flush">
      {c.free ? (
        <div className="cost-total">
          <strong className="free-big">Free for now</strong>
          <span className="muted small">
            Later about {m(c.totalMonthly)} per month
          </span>
        </div>
      ) : (
        <div className="cost-total">
          <span className="muted small">
            Estimated per month{c.simulated ? ' (simulated)' : ''}
          </span>
          <strong>{m(c.totalMonthly)}</strong>
        </div>
      )}
      <dl className="kv compact">
        <dt>Azure</dt>
        <dd>
          {`${m(c.azureMonthly)} (${c.tier.name}, ${c.environments} ${c.environments === 1 ? 'environment' : 'environments'}${c.databaseMonthly ? `, database ${m(c.databaseMonthly)}` : ''})`}
        </dd>
        <dt>Platform fee</dt>
        <dd>{`${m(c.platformFee)} (${c.platformFeePercent}%)`}</dd>
        <dt>Seats</dt>
        <dd>{`${m(c.seatCost)} (${c.seats} × ${m(c.seatFee)})`}</dd>
        <dt>Charged to</dt>
        <dd>
          {c.costCenter
            ? `${c.costCenter.id} ${c.costCenter.name}`.trim()
            : '-'}
        </dd>
      </dl>
      {c.tier.expiresDays ? (
        <p className="muted small">
          Removed after {c.tier.expiresDays} days unless moved to another tier.
        </p>
      ) : null}
    </div>
  );
}
