import type { Config, Mode } from '../config';
import { MODE_LABELS } from '../config';
import { MELODIES } from '../audio/melodies';

export type FieldType = 'range' | 'number' | 'select' | 'checkbox' | 'color' | 'text' | 'textarea' | 'midi';

export interface Field {
  key: keyof Config | 'midiFile';
  label: string;
  type: FieldType;
  min?: number;
  max?: number;
  step?: number;
  options?: [string, string][];
  /** Only shown for these modes. */
  modes?: Mode[];
  /** Visual/audio/output setting: changing it does not restart the simulation. */
  live?: boolean;
  hint?: string;
  /** Option value is a number. */
  numeric?: boolean;
}

export interface Group {
  title: string;
  open?: boolean;
  fields: Field[];
}

const ALL_EXCEPT = (...ex: Mode[]): Mode[] =>
  (Object.keys(MODE_LABELS) as Mode[]).filter((m) => !ex.includes(m));

export const GROUPS: Group[] = [
  {
    title: 'Chế độ',
    open: true,
    fields: [
      { key: 'mode', label: 'Kiểu video', type: 'select', options: Object.entries(MODE_LABELS) as [string, string][] },
      { key: 'seed', label: 'Seed (mỗi số = một video khác)', type: 'number', min: 0, max: 999999, step: 1 },
    ],
  },
  {
    title: 'Vòng tròn',
    open: true,
    fields: [
      { key: 'ringRadius', label: 'Bán kính', type: 'range', min: 150, max: 520, step: 1 },
      { key: 'ringThickness', label: 'Độ dày', type: 'range', min: 2, max: 40, step: 1 },
      { key: 'ringCount', label: 'Số vòng', type: 'range', min: 2, max: 40, step: 1, modes: ['destruction'] },
      { key: 'ringSpacing', label: 'Khoảng cách giữa các vòng', type: 'range', min: 8, max: 60, step: 1, modes: ['destruction'] },
      { key: 'gapAngle', label: 'Khe hở (độ, 0 = kín)', type: 'range', min: 0, max: 180, step: 1 },
      { key: 'rotationSpeed', label: 'Tốc độ xoay (độ/giây)', type: 'range', min: -360, max: 360, step: 1 },
      { key: 'alternateRotation', label: 'Các vòng xoay ngược chiều nhau', type: 'checkbox', modes: ['destruction'] },
    ],
  },
  {
    title: 'Bóng',
    open: true,
    fields: [
      { key: 'initialBalls', label: 'Số bóng ban đầu', type: 'range', min: 0, max: 200, step: 1 },
      { key: 'ballRadius', label: 'Bán kính bóng', type: 'range', min: 3, max: 80, step: 0.5 },
      { key: 'maxBalls', label: 'Số bóng tối đa', type: 'range', min: 1, max: 20000, step: 1, modes: ['escape', 'merge'] },
      { key: 'spawnOnEscape', label: 'Sinh thêm khi 1 bóng thoát', type: 'range', min: 0, max: 5, step: 1, modes: ['escape'] },
      { key: 'growAmount', label: 'Lớn thêm mỗi lần nảy', type: 'range', min: 0, max: 15, step: 0.1, modes: ['grow', 'trail'] },
      { key: 'spawnInterval', label: 'Thả bóng mới mỗi (giây)', type: 'range', min: 0.05, max: 3, step: 0.05, modes: ['merge'] },
      { key: 'teamNames', label: 'Tên các đội (cách nhau dấu phẩy)', type: 'text', modes: ['koth'], hint: 'Tên màu (Red, Xanh, Vàng…) sẽ tự đổi màu bóng tương ứng' },
      { key: 'dropSpread', label: 'Độ lệch giữa các bóng (px)', type: 'range', min: 0.0001, max: 5, step: 0.0001, modes: ['symmetric'] },
    ],
  },
  {
    title: 'Vật lý',
    fields: [
      { key: 'gravity', label: 'Trọng lực', type: 'range', min: 0, max: 5000, step: 10 },
      { key: 'restitution', label: 'Độ nảy (1 = giữ nguyên năng lượng)', type: 'range', min: 0.1, max: 1.2, step: 0.01 },
      { key: 'speedBoost', label: 'Tăng tốc mỗi lần nảy (×)', type: 'range', min: 0.95, max: 1.1, step: 0.001 },
      { key: 'initialSpeed', label: 'Tốc độ ban đầu', type: 'range', min: 0, max: 3000, step: 10 },
      { key: 'maxSpeed', label: 'Tốc độ tối đa', type: 'range', min: 300, max: 8000, step: 10 },
      { key: 'ballCollisions', label: 'Bóng va chạm với nhau', type: 'checkbox', modes: ALL_EXCEPT('merge') },
    ],
  },
  {
    title: 'Hình ảnh',
    fields: [
      { key: 'bgColor', label: 'Màu nền', type: 'color', live: true },
      { key: 'ringRainbow', label: 'Vòng đổi màu cầu vồng', type: 'checkbox', live: true },
      { key: 'ringColor', label: 'Màu vòng', type: 'color', live: true },
      {
        key: 'colorMode', label: 'Màu bóng', type: 'select', live: true,
        options: [['rainbow', 'Mỗi bóng một màu'], ['cycle', 'Đổi màu mỗi lần nảy'], ['solid', 'Một màu']],
      },
      { key: 'ballColor', label: 'Màu bóng (khi chọn Một màu)', type: 'color', live: true },
      { key: 'glow', label: 'Hiệu ứng phát sáng', type: 'checkbox', live: true },
      { key: 'trailLength', label: 'Độ dài vệt đuôi', type: 'range', min: 0, max: 60, step: 1, live: true },
      { key: 'paintTrail', label: 'Vẽ vệt vĩnh viễn (tô màu)', type: 'checkbox', live: true },
      { key: 'particles', label: 'Mảnh vỡ / tia lửa', type: 'checkbox', live: true },
      { key: 'ballOutline', label: 'Viền trắng quanh bóng', type: 'checkbox', live: true },
    ],
  },
  {
    title: 'Chữ trên video',
    fields: [
      { key: 'title', label: 'Tiêu đề (câu hook)', type: 'textarea', live: true },
      { key: 'titleSize', label: 'Cỡ chữ', type: 'range', min: 24, max: 140, step: 1, live: true },
      { key: 'textColor', label: 'Màu chữ', type: 'color', live: true },
      { key: 'showCounter', label: 'Hiện bộ đếm', type: 'checkbox', live: true },
      { key: 'counterLabel', label: 'Nhãn bộ đếm', type: 'text', live: true },
      { key: 'showTimer', label: 'Hiện đồng hồ', type: 'checkbox', live: true },
      { key: 'endText', label: 'Chữ khi kết thúc ({winner} = tên đội thắng)', type: 'text', live: true, modes: ['grow', 'trail', 'destruction', 'koth'] },
    ],
  },
  {
    title: 'Âm thanh',
    fields: [
      { key: 'sound', label: 'Bật âm thanh', type: 'checkbox', live: true },
      {
        key: 'instrument', label: 'Nhạc cụ', type: 'select', live: true,
        options: [['marimba', 'Marimba'], ['piano', 'Piano'], ['bell', 'Chuông'], ['pluck', 'Gảy dây'], ['pop', 'Pop (bụp)'], ['chip', '8-bit']],
      },
      {
        key: 'noteMode', label: 'Cách chọn nốt', type: 'select', live: true,
        options: [['melody', 'Theo bài nhạc (mỗi lần nảy 1 nốt)'], ['scale', 'Lên xuống theo thang âm'], ['random', 'Ngẫu nhiên trong thang âm'], ['size', 'Theo kích thước bóng']],
      },
      {
        key: 'melodyName', label: 'Bài nhạc', type: 'select', live: true,
        options: [...Object.entries(MELODIES).map(([k, v]) => [k, v.label] as [string, string]), ['custom', 'Từ file MIDI của bạn']],
      },
      { key: 'midiFile', label: 'Nạp file MIDI (.mid)', type: 'midi', live: true },
      {
        key: 'scale', label: 'Thang âm', type: 'select', live: true,
        options: [['pentatonic', 'Ngũ cung'], ['major', 'Trưởng'], ['minor', 'Thứ'], ['blues', 'Blues'], ['japanese', 'Nhật Bản'], ['chromatic', 'Bán cung']],
      },
      { key: 'baseNote', label: 'Nốt gốc (60 = Đô giữa)', type: 'range', min: 36, max: 84, step: 1, live: true },
      { key: 'transpose', label: 'Dịch giọng (bán cung)', type: 'range', min: -24, max: 24, step: 1, live: true },
      { key: 'volume', label: 'Âm lượng', type: 'range', min: 0, max: 1.5, step: 0.01, live: true },
      { key: 'reverb', label: 'Vang (reverb)', type: 'range', min: 0, max: 1, step: 0.01, live: true },
      { key: 'minNoteGap', label: 'Khoảng cách tối thiểu giữa 2 nốt (giây)', type: 'range', min: 0, max: 0.3, step: 0.005, live: true },
      { key: 'ballHitSound', label: 'Có tiếng khi bóng va nhau', type: 'checkbox', live: true },
      { key: 'sfx', label: 'Hiệu ứng (vỡ vòng, thoát, kết thúc)', type: 'checkbox', live: true },
    ],
  },
  {
    title: 'Xuất video',
    open: true,
    fields: [
      {
        key: 'resolution', label: 'Khung hình', type: 'select',
        options: [['1080x1920', '1080×1920 dọc (TikTok/Shorts/Reels)'], ['720x1280', '720×1280 dọc'], ['1440x2560', '1440×2560 dọc (2K)'], ['1080x1080', '1080×1080 vuông'], ['1920x1080', '1920×1080 ngang (YouTube)']],
      },
      { key: 'fps', label: 'FPS', type: 'select', live: true, numeric: true, options: [['30', '30'], ['60', '60']] },
      { key: 'duration', label: 'Thời lượng tối đa (giây)', type: 'range', min: 3, max: 300, step: 1, live: true },
      { key: 'bitrate', label: 'Bitrate (Mbps)', type: 'range', min: 2, max: 50, step: 1, live: true },
      { key: 'stopOnFinish', label: 'Tự dừng khi kết thúc màn', type: 'checkbox', live: true },
      { key: 'endHold', label: 'Giữ thêm sau khi kết thúc (giây)', type: 'range', min: 0, max: 10, step: 0.5, live: true },
      {
        key: 'previewScale', label: 'Chất lượng xem trước', type: 'select', numeric: true,
        options: [['0.25', 'Thấp (nhanh nhất)'], ['0.5', 'Trung bình'], ['0.75', 'Cao'], ['1', 'Gốc']],
      },
    ],
  },
];
