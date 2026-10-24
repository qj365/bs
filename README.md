# Ball Studio

Công cụ tự làm video "bóng nảy" kiểu satisfying/ASMR cho TikTok, Shorts và Reels. Chạy hoàn toàn trên trình duyệt, không cần server và không mất phí.

## Tính năng

- **7 kiểu video:**
  - Thoát vòng (mỗi bóng thoát ra thì sinh thêm bóng mới)
  - Bóng lớn dần
  - Phá vòng (Destruction)
  - Vệt màu loang (Trail)
  - Gộp bóng (Merge)
  - Vua của vòng (King of the Hill)
  - Thả đối xứng (hiệu ứng hỗn loạn)
- **Tùy chỉnh đầy đủ:**
  - Vòng: kích thước, độ dày, khe hở, tốc độ xoay, số vòng.
  - Vật lý: trọng lực, độ nảy, tăng tốc.
  - Màu sắc, phát sáng, vệt đuôi, mảnh vỡ.
  - Chữ hook, bộ đếm, đồng hồ, chữ khi kết thúc.
- **Âm thanh:**
  - 6 nhạc cụ tổng hợp sẵn và reverb.
  - Mỗi cú nảy phát một nốt theo bài nhạc: có sẵn 6 bài public domain, hoặc **nạp file MIDI của bạn**.
  - Hoặc phát theo thang âm.
- **Xuất MP4:**
  - H.264 kèm AAC hoặc Opus. Khung dọc 1080×1920, 2K, vuông hoặc ngang; 30 hoặc 60 fps.
  - Có thể xuất hàng loạt nhiều seed liên tiếp để chọn bản đẹp nhất.
- **Tất định:** cùng một seed và cùng thông số luôn cho ra đúng một video. Xem trước thấy đẹp thì bản xuất ra sẽ y hệt.
- **Preset:** lưu và mở cấu hình dạng JSON. Lần chỉnh gần nhất được tự động ghi nhớ.

## Chạy trên Windows

1. Cài [Node.js LTS](https://nodejs.org).
2. Mở PowerShell trong thư mục dự án và chạy:
   ```
   npm install
   npm run dev
   ```
3. Mở http://localhost:5173 bằng **Chrome hoặc Edge**. Hai trình duyệt này hỗ trợ tốt nhất bộ mã hóa phần cứng H.264 và AAC.

Để có bản tĩnh dùng lâu dài: chạy `npm run build`, sau đó đưa thư mục `dist/` lên bất kỳ web host tĩnh nào (GitHub Pages, Netlify…) hoặc chạy `npm run preview`.

## Cách dùng nhanh

1. Chọn **Kiểu video**. Thông số phù hợp với kiểu đó sẽ được tự điền.
2. Chỉnh thông số ở cột trái. Khung xem trước tự chạy lại; riêng màu, chữ và âm thanh đổi ngay mà không cần chạy lại.
3. Bấm **🎲 Seed ngẫu nhiên** cho đến khi ra kịch bản ưng ý.
4. Bấm **⬇ Xuất MP4**, hoặc **Xuất hàng loạt** N video với các seed liên tiếp.

## Kiến trúc và hiệu năng

```
sim/        Rust → WebAssembly: vật lý tất định 240 Hz, lưới không gian cho va chạm bóng–bóng
src/sim.ts  Lớp bọc WASM; đọc thẳng bộ đệm kết quả trong bộ nhớ WASM (không sao chép)
src/render/ WebGL2: mỗi loại đối tượng (bóng, vệt, vòng, hạt) vẽ bằng 1 lệnh instanced, hình tròn/vòng cung vẽ bằng SDF
src/audio/  Bộ tổng hợp WebAudio, chọn nốt theo MIDI hoặc thang âm, dựng nhạc offline khi xuất
src/export/ Web Worker: mô phỏng → WebGL (OffscreenCanvas) → VideoEncoder (ưu tiên GPU) → mp4-muxer
src/ui/     Bảng điều khiển sinh tự động từ schema
```

- **Vật lý trong WASM:** 3.600 bóng × 30 giây ở 240 Hz chỉ tốn khoảng 0,25 giây CPU.
- **WebGL instanced:** chi phí vẽ gần như không tăng theo số bóng.
- **Mã hóa phần cứng:** dùng NVENC, QuickSync hoặc AMF qua WebCodecs.
- **Áp lực ngược (back-pressure):** hàng đợi của bộ mã hóa được giới hạn nên RAM không phình khi xuất video dài.
- **Xuất trong Worker:** giao diện không bị đơ trong lúc xuất.

## Sửa lõi vật lý (Rust)

File `src/wasm/ball_sim.wasm` đã được build sẵn và commit kèm, nên nếu không sửa Rust thì không cần cài Rust.

Nếu sửa `sim/src/lib.rs`:

```
rustup target add wasm32-unknown-unknown
npm run build:wasm
```

Thứ tự tham số trong `src/sim.ts` (hằng `P`) phải khớp với các hằng `P_*` trong `lib.rs`.
