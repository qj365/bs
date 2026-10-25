import type { Config, Mode } from '../config';
import { MODE_INFO } from '../config';
import { MELODIES } from '../audio/melodies';

export type FieldType = 'range' | 'number' | 'select' | 'checkbox' | 'color' | 'text' | 'textarea' | 'action';

export interface Field<C = Config> {
  key: (keyof C & string) | `action:${string}`;
  label: string;
  type: FieldType;
  min?: number;
  max?: number;
  step?: number;
  options?: [string, string][];
  /** Only shown for these modes. */
  modes?: readonly string[];
  /** Visual/audio/output setting: changing it does not restart the simulation. */
  live?: boolean;
  hint?: string;
  /** Option value is a number. */
  numeric?: boolean;
}

export interface Group<C = Config> {
  id: string;
  title: string;
  open?: boolean;
  fields: Field<C>[];
}

const ALL = Object.keys(MODE_INFO) as Mode[];
const EXCEPT = (...ex: Mode[]): Mode[] => ALL.filter((m) => !ex.includes(m));
const RING_MODES = EXCEPT('spiral');

export const GROUPS: Group[] = [
  {
    id: 'arena',
    title: '⭕ Vòng tròn',
    open: true,
    fields: [
      {
        key: 'arenaSides', label: 'Hình dạng', type: 'select', numeric: true, modes: RING_MODES,
        options: [['0', 'Tròn'], ['3', 'Tam giác'], ['4', 'Vuông'], ['5', 'Ngũ giác'], ['6', 'Lục giác'], ['7', 'Thất giác (7 cạnh)'], ['8', 'Bát giác'], ['10', '10 cạnh'], ['12', '12 cạnh']],
      },
      { key: 'ringRadius', label: 'Bán kính', type: 'range', min: 150, max: 520, step: 1 },
      { key: 'ringThickness', label: 'Độ dày', type: 'range', min: 2, max: 40, step: 1 },
      { key: 'ringCount', label: 'Số vòng', type: 'range', min: 2, max: 40, step: 1, modes: ['destruction'] },
      { key: 'ringSpacing', label: 'Khoảng cách giữa các vòng', type: 'range', min: 8, max: 60, step: 1, modes: ['destruction'] },
      { key: 'gapAngle', label: 'Khe hở (độ, 0 = kín)', type: 'range', min: 0, max: 180, step: 1, modes: RING_MODES },
      { key: 'rotationSpeed', label: 'Tốc độ xoay (độ/giây)', type: 'range', min: -360, max: 360, step: 1, modes: RING_MODES },
      { key: 'alternateRotation', label: 'Các vòng xoay ngược chiều nhau', type: 'checkbox', modes: ['destruction'] },
      { key: 'spiralTurns', label: 'Số vòng xoắn', type: 'range', min: 2, max: 12, step: 0.5, modes: ['spiral'] },
      { key: 'spiralSpeed', label: 'Tốc độ xoắn đẩy ra (độ/giây)', type: 'range', min: -360, max: 360, step: 1, modes: ['spiral'] },
      { key: 'gemCount', label: 'Số kim cương (nhân điểm)', type: 'range', min: 0, max: 60, step: 1, modes: ['spiral'] },
    ],
  },
  {
    id: 'extras',
    title: '✨ Gai, kính, vật phẩm, dây',
    fields: [
      { key: 'spikeArc', label: 'Vùng gai (độ, 0 = không có)', type: 'range', min: 0, max: 360, step: 1, modes: RING_MODES },
      {
        key: 'spikeEffect', label: 'Chạm gai thì', type: 'select', modes: RING_MODES,
        options: [['destroy', 'Bóng vỡ tan'], ['freeze', 'Bóng dính lại'], ['bounce', 'Chỉ nảy (trang trí)']],
      },
      { key: 'spikeSize', label: 'Kích thước gai (ban đầu)', type: 'range', min: 2, max: 40, step: 1, modes: RING_MODES },
      { key: 'spikeGrow', label: 'Gai mọc dài thêm (px/giây, 0 = cố định)', type: 'range', min: 0, max: 40, step: 0.5, modes: RING_MODES },
      { key: 'ringHp', label: 'Vòng kính: vỡ sau N lần va (0 = vòng cứng)', type: 'range', min: 0, max: 300, step: 1, modes: RING_MODES },
      { key: 'powerups', label: 'Vật phẩm (nhân đôi, tăng tốc, to, nhỏ)', type: 'checkbox', modes: EXCEPT('spiral', 'merge') },
      { key: 'powerupInterval', label: 'Vật phẩm xuất hiện mỗi (giây)', type: 'range', min: 0.5, max: 15, step: 0.5, modes: EXCEPT('spiral', 'merge') },
      { key: 'impactLines', label: 'Dây va chạm: số dây mỗi bóng (0 = tắt)', type: 'range', min: 0, max: 64, step: 1 },
      {
        key: 'impactMode', label: 'Kiểu dây', type: 'select',
        options: [['strings', 'Nối bóng tới các điểm chạm'], ['chain', 'Nối các điểm chạm với nhau']],
      },
      { key: 'explodeCount', label: 'Số bóng khi nổ', type: 'range', min: 10, max: 3000, step: 10, modes: ['collision'] },
      { key: 'portals', label: 'Cổng dịch chuyển (vào cam, ra xanh)', type: 'checkbox', modes: RING_MODES },
      { key: 'portalSize', label: 'Kích thước cổng', type: 'range', min: 12, max: 120, step: 1, modes: RING_MODES },
      { key: 'magnet', label: 'Nam châm ở tâm (âm = đẩy ra)', type: 'range', min: -3000, max: 3000, step: 50 },
      { key: 'wind', label: 'Gió liên tục (âm = sang trái)', type: 'range', min: -3000, max: 3000, step: 50 },
      { key: 'action:chaos', label: '⚡ Biến cố theo thời gian…', type: 'action' },
    ],
  },
  {
    id: 'balls',
    title: '🔴 Bóng',
    open: true,
    fields: [
      { key: 'initialBalls', label: 'Số bóng ban đầu', type: 'range', min: 0, max: 200, step: 1 },
      { key: 'ballRadius', label: 'Bán kính bóng', type: 'range', min: 3, max: 80, step: 0.5 },
      { key: 'maxBalls', label: 'Số bóng tối đa', type: 'range', min: 1, max: 20000, step: 1, modes: ['escape', 'infinite', 'merge', 'accumulation'] },
      { key: 'spawnOnEscape', label: 'Sinh thêm khi 1 bóng thoát (0 = dừng ngay)', type: 'range', min: 0, max: 5, step: 1, modes: ['escape', 'infinite'] },
      { key: 'growAmount', label: 'Lớn thêm mỗi lần nảy', type: 'range', min: 0, max: 15, step: 0.1, modes: ['grow', 'trail'] },
      { key: 'spawnInterval', label: 'Thả bóng mới mỗi (giây)', type: 'range', min: 0.05, max: 3, step: 0.05, modes: ['merge', 'accumulation'] },
      { key: 'heroBall', label: 'Thêm 1 bóng đặc biệt (cỡ & màu riêng)', type: 'checkbox', modes: EXCEPT('koth', 'collision', 'spiral') },
      { key: 'heroRadius', label: 'Bán kính bóng đặc biệt', type: 'range', min: 4, max: 160, step: 1, modes: EXCEPT('koth', 'collision', 'spiral') },
      { key: 'heroColor', label: 'Màu bóng đặc biệt', type: 'color', live: true, modes: EXCEPT('koth', 'collision', 'spiral') },
      { key: 'teamNames', label: 'Tên các đội (cách nhau dấu phẩy)', type: 'text', modes: ['koth', 'collision'], hint: 'Tên màu (Red, Xanh, Vàng…) sẽ tự đổi màu bóng tương ứng' },
      { key: 'dropSpread', label: 'Độ lệch giữa các bóng (px)', type: 'range', min: 0.0001, max: 5, step: 0.0001, modes: ['symmetric'] },
    ],
  },
  {
    id: 'physics',
    title: '🧲 Vật lý',
    fields: [
      { key: 'gravity', label: 'Trọng lực', type: 'range', min: 0, max: 5000, step: 10 },
      { key: 'restitution', label: 'Độ nảy (1 = giữ nguyên năng lượng)', type: 'range', min: 0.1, max: 1.2, step: 0.01 },
      { key: 'speedBoost', label: 'Tăng tốc mỗi lần nảy (×)', type: 'range', min: 0.95, max: 1.1, step: 0.001 },
      { key: 'initialSpeed', label: 'Tốc độ ban đầu', type: 'range', min: 0, max: 3000, step: 10 },
      { key: 'maxSpeed', label: 'Tốc độ tối đa', type: 'range', min: 300, max: 8000, step: 10 },
      { key: 'ballCollisions', label: 'Bóng va chạm với nhau', type: 'checkbox', modes: EXCEPT('merge', 'collision') },
    ],
  },
  {
    id: 'visual',
    title: '🎨 Hình ảnh',
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
    id: 'text',
    title: '🔤 Chữ & watermark',
    fields: [
      { key: 'title', label: 'Tiêu đề (câu hook)', type: 'textarea', live: true },
      { key: 'titleSize', label: 'Cỡ chữ', type: 'range', min: 24, max: 140, step: 1, live: true },
      { key: 'textColor', label: 'Màu chữ', type: 'color', live: true },
      { key: 'showCounter', label: 'Hiện bộ đếm', type: 'checkbox', live: true },
      { key: 'counterLabel', label: 'Nhãn bộ đếm', type: 'text', live: true },
      { key: 'showTimer', label: 'Hiện đồng hồ', type: 'checkbox', live: true },
      { key: 'endText', label: 'Chữ khi kết thúc ({winner} = tên đội thắng)', type: 'text', live: true },
      { key: 'subtitle', label: 'Dòng chữ phụ phía dưới (vd: Did you recognize the music?)', type: 'text', live: true },
      { key: 'subtitleSize', label: 'Cỡ chữ phụ', type: 'range', min: 16, max: 100, step: 1, live: true },
      { key: 'subtitleFrom', label: 'Hiện chữ phụ từ giây (0 = luôn hiện)', type: 'range', min: 0, max: 120, step: 0.5, live: true },
      { key: 'watermark', label: 'Watermark (vd: @tenkenh)', type: 'text', live: true },
      {
        key: 'watermarkPos', label: 'Vị trí watermark', type: 'select', live: true,
        options: [['br', 'Dưới phải'], ['bl', 'Dưới trái'], ['tr', 'Trên phải'], ['tl', 'Trên trái'], ['center', 'Giữa']],
      },
      { key: 'watermarkOpacity', label: 'Độ đậm watermark', type: 'range', min: 0.1, max: 1, step: 0.05, live: true },
    ],
  },
  {
    id: 'audio',
    title: '🎵 Âm thanh',
    fields: [
      { key: 'sound', label: 'Bật âm thanh', type: 'checkbox', live: true },
      {
        key: 'instrument', label: 'Nhạc cụ', type: 'select', live: true,
        options: [
          ['marimba', 'Marimba'], ['piano', 'Piano'], ['bell', 'Chuông'], ['musicbox', 'Hộp nhạc'], ['harp', 'Đàn hạc'],
          ['guitar', 'Guitar'], ['pluck', 'Gảy dây'], ['organ', 'Organ'], ['synth', 'Synth'], ['pop', 'Pop (bụp)'],
          ['chip', '8-bit'], ['glass', 'ASMR · thủy tinh'], ['marble', 'ASMR · bi ve'], ['wood', 'ASMR · gỗ'], ['drop', 'ASMR · giọt nước'], ['drum', 'Trống'], ['gong', 'Cồng chiêng'], ['boing', 'Lò xo (boing)'],
          ['sample', '🎙 Âm thanh của bạn'],
        ],
      },
      { key: 'action:sample', label: 'Nạp file âm thanh (wav/mp3/ogg) làm nhạc cụ', type: 'action', live: true },
      { key: 'sampleBaseNote', label: 'Cao độ gốc của file (60 = Đô giữa)', type: 'range', min: 24, max: 96, step: 1, live: true },
      {
        key: 'noteMode', label: 'Cách chọn nốt', type: 'select', live: true,
        options: [['melody', 'Theo bài nhạc (mỗi lần nảy 1 nốt)'], ['scale', 'Lên xuống theo thang âm'], ['random', 'Ngẫu nhiên trong thang âm'], ['size', 'Theo kích thước bóng']],
      },
      {
        key: 'melodyName', label: 'Bài nhạc', type: 'select', live: true,
        options: [...Object.entries(MELODIES).map(([k, v]) => [k, v.label] as [string, string]), ['custom', '✏️ Giai điệu của bạn']],
      },
      { key: 'action:editor', label: 'Soạn giai điệu / nạp MIDI', type: 'action', live: true },
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
      { key: 'sfx', label: 'Hiệu ứng (vỡ, nổ, vật phẩm, kết thúc)', type: 'checkbox', live: true },
      { key: 'stereo', label: 'Âm thanh stereo theo vị trí bóng (đeo tai nghe)', type: 'checkbox', live: true },
      { key: 'action:music', label: '🎶 Nạp nhạc nền (mp3/wav)', type: 'action', live: true },
      { key: 'musicVolume', label: 'Âm lượng nhạc nền', type: 'range', min: 0, max: 1.5, step: 0.01, live: true },
      { key: 'beatSync', label: 'Khớp cú nảy với nhịp nhạc nền (beat-sync)', type: 'checkbox' },
      {
        key: 'beatStride', label: 'Nảy theo', type: 'select', numeric: true,
        options: [['0', 'Tự chọn'], ['1', 'Mỗi nhịp'], ['2', 'Mỗi 2 nhịp'], ['4', 'Mỗi 4 nhịp']],
      },
    ],
  },
  {
    id: 'output',
    title: '🎬 Video & hiệu năng',
    open: true,
    fields: [
      {
        key: 'battle', label: 'Đấu đôi chia màn hình', type: 'select', numeric: true,
        options: [['1', 'Tắt (1 đấu trường)'], ['2', '2 đấu trường đua nhau'], ['4', '4 đấu trường (2×2)']],
        hint: 'Cùng luật, khác seed — đấu trường nào kết thúc trước thì thắng',
      },
      {
        key: 'resolution', label: 'Khung hình', type: 'select',
        options: [['1080x1920', '1080×1920 dọc (TikTok/Shorts/Reels)'], ['720x1280', '720×1280 dọc'], ['1440x2560', '1440×2560 dọc (2K)'], ['2160x3840', '2160×3840 dọc (4K)'], ['1080x1080', '1080×1080 vuông'], ['1920x1080', '1920×1080 ngang (YouTube)']],
      },
      {
        key: 'safeZone', label: 'Né vùng bị che (vùng an toàn)', type: 'select',
        options: [['none', 'Không'], ['tiktok', 'TikTok / Reels'], ['shorts', 'YouTube Shorts']],
        hint: 'Dời vòng tròn và chữ khỏi chỗ bị nút bấm, caption của app che',
      },
      { key: 'showSafeZone', label: 'Hiện khung vùng an toàn khi xem trước (không xuất ra video)', type: 'checkbox', live: true },
      { key: 'fps', label: 'FPS', type: 'select', live: true, numeric: true, options: [['30', '30'], ['60', '60']] },
      { key: 'duration', label: 'Thời lượng tối đa (giây)', type: 'range', min: 3, max: 600, step: 1, live: true },
      { key: 'bitrate', label: 'Bitrate (Mbps)', type: 'range', min: 2, max: 80, step: 1, live: true },
      { key: 'stopOnFinish', label: 'Tự dừng khi kết thúc màn', type: 'checkbox', live: true },
      { key: 'endHold', label: 'Giữ thêm sau khi kết thúc (giây)', type: 'range', min: 0, max: 10, step: 0.5, live: true },
      { key: 'exportCaption', label: 'Kèm file caption + hashtag (.txt) khi xuất', type: 'checkbox', live: true },
      { key: 'exportCover', label: 'Kèm ảnh bìa (.png) khi xuất', type: 'checkbox', live: true },
      {
        key: 'renderer', label: 'Vẽ hình bằng', type: 'select',
        options: [['auto', 'Tự động (GPU, lỗi thì CPU)'], ['gpu', 'GPU — WebGL2 (nhanh)'], ['cpu', 'CPU — Canvas 2D (tương thích)']],
        hint: 'CPU dùng cho máy không có WebGL2, máy remote desktop hoặc driver GPU lỗi',
      },
      {
        key: 'encoder', label: 'Mã hóa video bằng', type: 'select', live: true,
        options: [['auto', 'Tự động (ưu tiên GPU)'], ['gpu', 'GPU — NVENC/QuickSync/AMF (nhanh)'], ['cpu', 'CPU — phần mềm (chất lượng ổn định)']],
        hint: 'GPU nhanh hơn nhiều; CPU chậm hơn nhưng đẹp hơn ở bitrate thấp và tránh lỗi driver',
      },
      {
        key: 'previewScale', label: 'Chất lượng xem trước', type: 'select', numeric: true,
        options: [['0.25', 'Thấp (nhanh nhất)'], ['0.5', 'Trung bình'], ['0.75', 'Cao'], ['1', 'Gốc']],
      },
    ],
  },
];
