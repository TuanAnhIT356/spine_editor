# Spec: Phase 17 — Animate dock (Graph/Dopesheet tabs, Spine toolbar, key ticks, pose-tạm)

- **Ngày**: 2026-07-11
- **Trạng thái**: Design đã duyệt
- **Phạm vi**: `packages/editor` (TimelinePanel + GraphEditor + store + Viewport/bone-edit
  cho pose-tạm). KHÔNG đụng core (Offset dùng lệnh `TransformBoneKeys` sẵn có).
  Hoàn tất Phase 17 của roadmap §8; 1 PR.

## 1. Tabs + Sync

- TimelinePanel state `tab: 'dopesheet' | 'graph'` — thanh tab ngay dưới
  `.timeline-header` (chuẩn screenshot Spine #4/#5). Dopesheet tab = khu tracks hiện
  tại; Graph tab = GraphEditor render full-height thay khu tracks (hết nhúng dưới key).
- Toggle **Sync** trên toolbar: khi BẬT, chọn key trong dopesheet đồng bộ key đang
  sửa của GraphEditor (chuyển tab Graph thấy đúng key); khi TẮT, Graph giữ key sửa
  gần nhất. (GraphEditor giữ nguyên năng lực hiện có.)

## 2. Toolbar (một hàng trên tracks, cả 2 tab)

- Trái: tabs Graph | Dopesheet (button, class `.tl-tab`, active highlight).
- **Filter ▾**: dropdown checkbox theo loại timeline
  (`rotate, translate, scale, shear, color, attachment, deform, draworder, event`)
  — tắt loại nào thì ẩn HÀNG loại đó khỏi dopesheet (state cục bộ, mặc định tất cả bật).
- **Lock** toggle: đóng băng danh sách bone-rows hiện tại (đổi selection không đổi
  danh sách; thêm bone mới không hiện) — lưu snapshot tên bones khi bật.
- **Shift**: ô number `±frames` + nút Apply — dịch các key ĐANG CHỌN theo delta
  (frames/30 giây), tái dùng đường commitKeyDrag hiện có (giữ nguyên validation/undo).
- **Offset**: ô number `±frames` + nút Apply — dịch TOÀN BỘ bone keys của animation
  hiện tại, wrap quanh duration (dùng `TransformBoneKeys` với offset; wrap = keys vượt
  duration trừ duration — nếu lệnh không hỗ trợ wrap thì offset thuần + clamp,
  ghi chú giới hạn trong tooltip).
- Phải: ô **Current** (frame hiện tại, 30fps, nhập → setAnimTime(frame/30));
  **Loop Start** / **End** (frame, trống = không đặt); nút ✕ xóa range.

## 3. Loop range

- `anim.loopStart: number | null`, `anim.loopEnd: number | null` (giây, editor-only,
  không serialize) + actions `setLoopRange(start, end)`, `clearLoopRange()`.
- Playback tick (nơi RAF advance time): khi `loop && loopEnd != null` → wrap từ
  loopEnd về loopStart ?? 0; khi không loop → dừng ở loopEnd như duration.
- Ruler tô nền vùng loop (`--accent-soft` alpha thấp).

## 4. Key ticks kiểu Spine (dopesheet)

- Màu tick theo loại timeline (CSS class `key-<type>`):
  rotate `#7bd47b`, translate `#6fa8dc`, scale `#e06666`, shear `#d5a6bd`,
  color `#ffd966`, attachment `#e0e0e0`, deform `#b4a7d6`, draworder `#f0a252`,
  event `#f0a252`.
- Hàng tổng per-bone (đã có? nếu chưa: thêm hàng bone gộp keys mọi timeline của nó):
  tick tại frame có ≥2 LOẠI khác nhau → class `key-multi` (trắng).
- Hàng tổng animation: dải sát ruler với **diamond đỏ** tại mọi frame có key
  (class `.summary-diamond`).
- Đường nối giữa 2 key liên tiếp trong MỖI hàng timeline: SVG line/patterns —
  linear = nét liền mảnh, bezier (key.curve là mảng) = nét liền đậm hơn cong nhẹ
  (đường cong trang trí, không cần chính xác), stepped = nét đứt (dasharray).
  Render bằng 1 <svg> absolute per track row.
- Giữ nguyên: click chọn key, drag dời, box-select, double-click xóa, curve menu.

## 5. Transport

- Hàng transport (trong `.timeline-header` hiện có): ⏮ (setAnimTime(loopStart ?? 0)),
  ◀| (prev key: playhead nhảy tới key gần nhất bên trái trong các hàng đang hiện),
  Play/Pause (GIỮ TEXT — e2e), |▶ (next key), ⏭ (setAnimTime(duration)),
  Loop toggle + speed + step frame (giữ nguyên các nút sẵn có, chỉ sắp lại).

## 6. Pose-tạm khi Auto Key OFF (nợ Phase 15)

- Store: `posePreview: Record<string, Partial<{x,y,rotation,scaleX,scaleY,shearX,shearY}>> | null`
  - `setPosePreview(bone, patch)` (merge), `clearPosePreview()`.
- `baseLocals()` (Viewport) + `buildRenderInput`: sau computeAnimatedLocals, merge
  posePreview (per-bone Object.assign) — CHỈ hiển thị, không đổi document.
- Viewport pointerup translate/rotate/scale/shear khi `animate && !autoKey`:
  thay vì error-gate (P15) → ghi kết quả drag vào posePreview. Deform/vertex vẫn gate.
- `applyBoneEdit` (ô số) khi `animate && !autoKey`: ghi posePreview.
- Clear posePreview khi: đổi playhead (setAnimTime), đổi animation, đổi mode,
  bật Auto Key.
- Nút key từng hàng trong ToolCluster khi !autoKey: chốt giá trị posePreview của
  bone (nếu có) thành keyframe qua đường auto-key rồi xóa entry đó.
  (ToolCluster hiển thị giá trị: merge posePreview vào `shown`.)

## 7. Kiểm chứng

1. Suites + build xanh; pytest nguyên trạng.
2. 4 e2e xanh — anim.mjs: GIỮ selector `.timeline-header button:has-text("New")`,
   `button:has-text("Play")`/`("Pause")`, `.track .key`, `.ruler`.
3. Screenshot đối chiếu screenshot Spine #5: tabs, toolbar, tick màu, diamond row.
4. Manual: Auto Key off → drag bone đổi pose không tạo key, scrub → pose về theo
   animation; bấm nút key → keyframe xuất hiện.
5. Loop range: đặt Start/End → play wrap đúng vùng.

## 8. Không làm

- Chế độ Adjust (viewport edits áp lên mọi key chọn) — phase sau.
- Copy/paste keys (đã có từ Phase 7), audio row (Phase 20), đổi GraphEditor engine.
