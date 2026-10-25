import { MELODIES } from '../audio/melodies';
import type { Group } from '../ui/schema';
import type { MarbleConfig } from './config';

const INSTRUMENTS: [string, string][] = [
  ['marimba', 'Marimba (gỗ)'], ['musicbox', 'Hộp nhạc'], ['bell', 'Chuông'], ['piano', 'Piano'], ['harp', 'Đàn hạc'],
  ['pluck', 'Gảy dây'], ['glass', 'ASMR · thủy tinh'], ['wood', 'ASMR · gỗ'], ['marble', 'ASMR · bi ve'], ['chip', '8-bit'],
];

export const MARBLE_GROUPS: Group<MarbleConfig>[] = [
  {
    id: 'music',
    title: '🎼 Bài nhạc',
    open: true,
    fields: [
      {
        key: 'song', label: 'Bài', type: 'select',
        options: [...Object.entries(MELODIES).map(([k, m]) => [k, m.label] as [string, string]), ['midi', '🎹 File MIDI của bạn']],
      },
      { key: 'action:midi', label: '📂 Nạp file MIDI (.mid)', type: 'action', hint: 'Giữ nguyên nhịp của bài — mỗi nốt là một lần chạm phím' },
      { key: 'bpm', label: 'Nhịp (BPM) cho bài có sẵn', type: 'range', min: 40, max: 260, step: 1 },
      { key: 'repeats', label: 'Lặp lại bài', type: 'range', min: 1, max: 10, step: 1 },
      { key: 'transpose', label: 'Dịch giọng (nửa cung)', type: 'range', min: -24, max: 24, step: 1 },
    ],
  },
  {
    id: 'course',
    title: '🛤 Đường chạy',
    open: true,
    fields: [
      { key: 'seed', label: 'Seed bố cục', type: 'number', min: 0, step: 1 },
      { key: 'width', label: 'Độ rộng giữa hai hàng phím', type: 'range', min: 0.3, max: 2.5, step: 0.05 },
      { key: 'descent', label: 'Tốc độ rơi xuống', type: 'range', min: 0.3, max: 8, step: 0.1 },
      { key: 'gravity', label: 'Trọng lực', type: 'range', min: 2, max: 30, step: 0.5 },
      {
        key: 'rollGap', label: 'Nốt nhanh hơn mức này thành dãy phím lăn (giây)', type: 'range', min: 0, max: 0.3, step: 0.01,
        hint: 'Chuỗi ≥3 nốt sát nhau: bi lăn trên ray qua một dãy phím',
      },
      { key: 'restGap', label: 'Khoảng nghỉ dài hơn mức này đi qua máng cong (giây)', type: 'range', min: 0.8, max: 6, step: 0.1 },
      { key: 'splitPitch', label: 'Nốt từ cao độ này trở lên dùng nhạc cụ 2', type: 'range', min: 36, max: 108, step: 1 },
    ],
  },
  {
    id: 'look',
    title: '🎨 Hình ảnh',
    fields: [
      { key: 'bgColor', label: 'Màu nền / sương', type: 'color', live: true },
      { key: 'fog', label: 'Độ dày sương', type: 'range', min: 0, max: 1, step: 0.05, live: true },
      { key: 'barColor', label: 'Phím chưa gõ', type: 'color', live: true },
      { key: 'playedColor', label: 'Phím đã gõ', type: 'color', live: true },
      { key: 'holderColor', label: 'Giá đỡ', type: 'color' },
      { key: 'ballColor', label: 'Viên bi', type: 'color', live: true },
      { key: 'stripeColor', label: 'Vạch trên bi', type: 'color', live: true },
      { key: 'cameraDistance', label: 'Camera: khoảng cách', type: 'range', min: 1.5, max: 8, step: 0.1, live: true },
      { key: 'cameraAngle', label: 'Camera: góc xoay quanh (độ)', type: 'range', min: -90, max: 90, step: 1, live: true },
      { key: 'cameraElevation', label: 'Camera: góc nhìn từ trên (độ)', type: 'range', min: -30, max: 85, step: 1, live: true },
      { key: 'light', label: 'Độ sáng đèn', type: 'range', min: 0.2, max: 2.5, step: 0.05, live: true },
      { key: 'shadows', label: 'Bóng đổ', type: 'checkbox', live: true },
      { key: 'flash', label: 'Phím lóe sáng khi chạm', type: 'checkbox', live: true },
    ],
  },
  {
    id: 'text',
    title: '🔤 Chữ',
    fields: [
      { key: 'title', label: 'Tiêu đề (trên)', type: 'textarea', live: true },
      { key: 'titleSize', label: 'Cỡ tiêu đề', type: 'range', min: 12, max: 80, step: 1, live: true },
      { key: 'subtitle', label: 'Chữ phụ (dưới)', type: 'textarea', live: true },
      { key: 'subtitleSize', label: 'Cỡ chữ phụ', type: 'range', min: 10, max: 60, step: 1, live: true },
      { key: 'textColor', label: 'Màu chữ', type: 'color', live: true },
    ],
  },
  {
    id: 'audio',
    title: '🔊 Âm thanh',
    fields: [
      { key: 'sound', label: 'Bật âm thanh', type: 'checkbox', live: true },
      { key: 'lowInstrument', label: 'Nhạc cụ 1 (nốt trầm)', type: 'select', live: true, options: INSTRUMENTS },
      { key: 'highInstrument', label: 'Nhạc cụ 2 (nốt cao)', type: 'select', live: true, options: INSTRUMENTS },
      { key: 'rollSound', label: 'Tiếng bi lăn trên ray / máng', type: 'checkbox', live: true },
      { key: 'volume', label: 'Âm lượng', type: 'range', min: 0, max: 1.5, step: 0.05, live: true },
      { key: 'reverb', label: 'Vang', type: 'range', min: 0, max: 1, step: 0.05, live: true },
    ],
  },
  {
    id: 'output',
    title: '🎬 Xuất video',
    fields: [
      {
        key: 'resolution', label: 'Khung hình', type: 'select', live: true,
        options: [['1080x1920', '1080×1920 dọc'], ['720x1280', '720×1280 dọc'], ['1440x2560', '1440×2560 dọc (2K)'], ['1080x1080', '1080×1080 vuông'], ['1920x1080', '1920×1080 ngang']],
      },
      { key: 'fps', label: 'FPS', type: 'select', live: true, numeric: true, options: [['30', '30'], ['60', '60']] },
      { key: 'bitrate', label: 'Bitrate (Mbps)', type: 'range', min: 2, max: 60, step: 1, live: true },
      {
        key: 'encoder', label: 'Mã hóa video bằng', type: 'select', live: true,
        options: [['auto', 'Tự động (ưu tiên GPU)'], ['gpu', 'GPU (nhanh)'], ['cpu', 'CPU (phần mềm)']],
      },
    ],
  },
];
