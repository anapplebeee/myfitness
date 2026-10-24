import { computed, reactive, readonly, ref } from 'vue';
import type { AppState, FoodEntry, Profile, Session, SessionExercise, SetRecord, WeightEntry } from '../domain/types';
import { businessDate } from '../domain/units';
import { loadState, saveState } from './repository';
import { seedState } from './seed';

const state = reactive<AppState>(seedState());
const ready = ref(false);
const saveError = ref<string | null>(null);
const savedAt = ref<string | null>(null);
let saveTimer: number | null = null;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function persist(): Promise<void> {
  try {
    await saveState(state);
    saveError.value = null;
    savedAt.value = new Date().toISOString();
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败';
  }
}

function schedulePersist(): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 120);
}

export const store = {
  state: readonly(state) as Readonly<AppState>,
  ready,
  saveError,
  savedAt,

  async init(): Promise<void> {
    try {
      const loaded = await Promise.race([
        loadState(),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1200)),
      ]);
      if (loaded && loaded.version === 2) {
        Object.assign(state, loaded);
        state.profile = { ...state.profile, ...loaded.profile };
      } else {
        Object.assign(state, seedState());
      }
    } catch {
      Object.assign(state, seedState());
    } finally {
      ready.value = true;
    }
  },

  updateProfile(patch: Partial<Profile>): void {
    Object.assign(state.profile, patch);
    if (patch.weeklyTarget !== undefined) state.weeklyGoal = patch.weeklyTarget;
    schedulePersist();
  },

  setTemplate(templateId: string | null): void {
    state.activeTemplateId = templateId;
    schedulePersist();
  },

  createSession(session: Session): Session {
    state.sessions.push(session);
    schedulePersist();
    return session;
  },

  findSession(id: string): Session | undefined {
    return state.sessions.find((s) => s.id === id);
  },

  updateSession(id: string, patch: Partial<Session>): void {
    const s = state.sessions.find((x) => x.id === id);
    if (!s) return;
    Object.assign(s, patch);
    schedulePersist();
  },

  addExerciseToSession(sessionId: string, ex: SessionExercise): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    ex.order = s.exercises.length;
    s.exercises.push(ex);
    schedulePersist();
  },

  replaceExerciseInSession(sessionId: string, exerciseId: string, nextExerciseId: string): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    const target = s.exercises.find((x) => x.exerciseId === exerciseId);
    if (!target) return;
    target.exerciseId = nextExerciseId;
    for (const set of target.sets) {
      if (set.status !== 'completed') set.status = 'skipped';
    }
    schedulePersist();
  },

  removeExerciseFromSession(sessionId: string, exerciseId: string): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    s.exercises = s.exercises.filter((x) => x.exerciseId !== exerciseId);
    s.exercises.forEach((x, i) => {
      x.order = i;
    });
    schedulePersist();
  },

  completeSet(sessionId: string, exerciseId: string, setId: string, patch: Partial<SetRecord>): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    const ex = s.exercises.find((x) => x.exerciseId === exerciseId);
    if (!ex) return;
    const set = ex.sets.find((x) => x.id === setId);
    if (!set) return;
    Object.assign(set, patch, { status: 'completed', completedAt: new Date().toISOString() });
    schedulePersist();
  },

  skipSet(sessionId: string, exerciseId: string, setId: string): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    const ex = s.exercises.find((x) => x.exerciseId === exerciseId);
    const set = ex?.sets.find((x) => x.id === setId);
    if (!set) return;
    set.status = 'skipped';
    schedulePersist();
  },

  addSet(sessionId: string, exerciseId: string): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    const ex = s?.exercises.find((x) => x.exerciseId === exerciseId);
    if (!ex) return;
    const last = ex.sets[ex.sets.length - 1];
    ex.sets.push({
      id: uid('set'),
      kind: 'work',
      status: 'planned',
      loadGrams: last?.loadGrams ?? null,
      reps: last?.reps ?? null,
      durationSeconds: null,
      distanceMeters: null,
      rpe: null,
      completedAt: null,
    });
    ex.targetSets += 1;
    schedulePersist();
  },

  addWeight(grams: number, date = businessDate(), note = ''): void {
    const existing = state.weights.find((w) => w.date === date);
    if (existing) {
      existing.grams = grams;
      existing.note = note;
    } else {
      state.weights.push({ id: uid('w'), date, grams, note } as WeightEntry);
      state.weights.sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    schedulePersist();
  },

  removeWeight(date: string): void {
    state.weights = state.weights.filter((w) => w.date !== date);
    schedulePersist();
  },

  addFood(entry: Omit<FoodEntry, 'id' | 'createdAt'>): void {
    state.foods.push({ ...entry, id: uid('f'), createdAt: new Date().toISOString() });
    schedulePersist();
  },

  removeFood(id: string): void {
    state.foods = state.foods.filter((f) => f.id !== id);
    schedulePersist();
  },

  setTargets(kcal: number | null, protein: number | null): void {
    state.targetKcal = kcal;
    state.targetProtein = protein;
    schedulePersist();
  },

  newId(prefix: string): string {
    return uid(prefix);
  },
};

const weightSeries = computed<WeightEntry[]>(() =>
  [...store.state.weights].sort((a, b) => (a.date < b.date ? -1 : 1)),
);

const latestWeight = computed<WeightEntry | null>(
  () => weightSeries.value[weightSeries.value.length - 1] ?? null,
);

export const derived = { weightSeries, latestWeight };
