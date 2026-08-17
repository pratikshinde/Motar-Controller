/**
 * Layer-A settings keys — MCU <-> module, authoritative from `IoT_Comm.c`
 * as recorded in SRS v7.0 §6.1. These are real, shipping firmware keys,
 * not an invented configuration schema: a `settings` message with any
 * other key is rejected by the bridge (FR-CON-043).
 *
 * Grouping (Protection / Timers / Motor & Sensing) is presentational only
 * — the wire format has no groups, this just makes the form legible.
 */

export type FieldKind = 'number' | 'boolean';

export interface LayerAField {
  key: string;
  label: string;
  kind: FieldKind;
  unit?: string;
  min?: number;
  max?: number;
}

export interface LayerAGroup {
  title: string;
  fields: LayerAField[];
}

export const layerAGroups: LayerAGroup[] = [
  {
    title: 'Protection',
    fields: [
      { key: 'ov', label: 'Over-voltage trip', kind: 'number', unit: 'V', min: 300, max: 600 },
      { key: 'uv', label: 'Under-voltage trip', kind: 'number', unit: 'V', min: 250, max: 400 },
      { key: 'uv_t', label: 'Under-voltage delay', kind: 'number', unit: 's', min: 1, max: 60 },
      { key: 'dr', label: 'Dry-run trip current', kind: 'number', unit: 'A', min: 1, max: 50 },
      { key: 'dr_t', label: 'Dry-run trip delay', kind: 'number', unit: 's', min: 0, max: 25 },
      { key: 'dr_rst', label: 'Dry-run restart delay', kind: 'number', unit: 'min', min: 0, max: 250 },
      { key: 'ol', label: 'Overload trip', kind: 'number', unit: 'A', min: 2, max: 140 },
      { key: 'imb', label: 'Imbalance trip', kind: 'number', unit: '%', min: 1, max: 80 },
      { key: 'ps', label: 'Phase-sequence check', kind: 'boolean' }
    ]
  },
  {
    title: 'Timers',
    fields: [
      { key: 'as', label: 'Auto-start delay', kind: 'number', unit: 's', min: 2, max: 600 },
      { key: 'sd', label: 'Star-delta delay', kind: 'number', unit: 's', min: 1, max: 60 },
      { key: 'ar', label: 'Auto restart', kind: 'boolean' },
      { key: 'cyc', label: 'Cyclic timer', kind: 'boolean' },
      { key: 'on_t', label: 'Motor ON time', kind: 'number', unit: 'min', min: 1, max: 250 },
      { key: 'rst_t', label: 'Motor restart time', kind: 'number', unit: 'min', min: 0, max: 250 }
    ]
  },
  {
    title: 'Motor & Sensing',
    fields: [
      { key: 'hp', label: 'Motor rating index', kind: 'number', min: 1, max: 13 },
      { key: 'ct', label: 'CT ratio', kind: 'number', min: 1, max: 50 },
      { key: 'ph', label: 'PH ratio', kind: 'number', min: 0, max: 15 }
    ]
  }
];

export const allLayerAFields: LayerAField[] = layerAGroups.flatMap(g => g.fields);
