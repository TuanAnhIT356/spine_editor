# Spec: Phase 18 — TrackMixer + Preview view + Ghosting config

- **Ngày**: 2026-07-11
- **Trạng thái**: Design đã duyệt
- **Phạm vi**: `core` (mixer.ts + tests), `editor` (PreviewWindow, ghostConfig,
  Views ▾ mục Preview/Ghosting). Playback view GỘP (transport P17 + Preview phủ).
  1 PR — Phase 18 của roadmap §8.

## 1. Core `src/mixer.ts` — TrackMixer (TDD)

```ts
export interface TrackState {
  animation: string | null; // đang chạy
  prev: string | null; // animation đang fade-out (crossfade)
  time: number;
  prevTime: number;
  mixDuration: number;
  mixElapsed: number;
  speed: number; // timeScale (mặc định 1)
  loop: boolean; // repeat (mặc định true)
  alpha: number; // 0..1, track > 0 (mặc định 1)
  holdPrevious: boolean; // giữ prev weight 1 khi fade-in (chống dipping)
  additive: boolean; // cộng offset thay vì thay thế
}
export class TrackMixer {
  constructor(data: SkeletonData, trackCount = 4);
  readonly tracks: TrackState[];
  setAnimation(track: number, name: string | null, mixDuration?: number): void;
  setTrackProps(
    track: number,
    patch: Partial<
      Pick<TrackState, 'speed' | 'loop' | 'alpha' | 'holdPrevious' | 'additive' | 'mixDuration'>
    >,
  ): void;
  update(dt: number): void; // advance time/prevTime/mixElapsed (wrap theo loop)
  pose(): BoneData[]; // locals đã trộn
}
```

- `setAnimation`: nếu track đang có animation → prev = current, prevTime giữ,
  mixElapsed = 0; name = null → clear (prev = current để fade-out về setup/lower).
- `pose()` — thứ tự:
  1. Kết quả khởi đầu = setup locals (clone `data.bones`).
  2. Với mỗi track 0..n có animation/prev: tính pose track =
     crossfade(prevPose, currentPose, w) với w = min(mixElapsed/mixDuration, 1)
     (mixDuration 0 → w=1); holdPrevious → prevPose weight giữ 1: kết quả =
     lerp(prevPose, currentPose, w) NHƯNG prev không giảm — thực dụng:
     holdPrevious thì crossfade dùng max(w, …) không hạ prev sớm — đơn giản hóa:
     result = prevPose*(1) trộn currentPose*w chuẩn hoá — chọn công thức
     lerp(prevPose, currentPose, w) cho cả hai, riêng holdPrevious thì
     prevPose = pose đầy đủ (không phai) đến khi w >= 1. (Ghi rõ: xấp xỉ đủ cho
     preview, không cam kết parity runtime.)
  3. Trộn vào kết quả: track 0 → thay thế (lerp từ setup theo w tổng = 1);
     track >0: additive ? result += (trackPose − setup) × alpha
     : result = lerp(result, trackPose, alpha).
     rotate lerp theo cung ngắn nhất (chuẩn hóa ±180°).
- Chỉ BONE locals (rotate/translate/scale/shear qua computeAnimatedLocals);
  deform/attachment/draworder timelines ngoài phạm vi (ghi trong Không làm).
- Tests `core/test/mixer.test.ts`: (a) crossfade 2 animation rotate 0→90 tại
  w=0.5 cho 45; (b) track 1 alpha 0.5 lerp nửa đường; (c) additive cộng offset;
  (d) holdPrevious giữ pose prev nguyên khi w<1; (e) loop wrap time; (f) speed
  2× chạy nhanh gấp đôi; (g) setAnimation(null) fade về setup.

## 2. Editor — PreviewWindow (`components/PreviewWindow.tsx`)

- Cửa sổ nổi (pattern ChatWindow: kéo header, resize, vị trí localStorage
  `spine-editor.preview-window`, mặc định 460×560). Mở/đóng từ Views ▾ mục
  **Preview** (checkbox trong dropdown, state cục bộ Toolbar như showChat).
- Canvas: `SceneRenderer` thứ hai init vào div riêng; RAF loop: mixer.update(dt)
  → renderer.render({data, bonesOverride: mixer.pose(), activeSkin, assets,
  selection: []}); pan/zoom hoạt động nhờ renderer sẵn có (wheel tự gắn?
  renderer.zoomAt gọi qua wheel listener thêm trong window).
- UI phải: list animations (click gán track active — `mixer.setAnimation(active,
name, mixField)`; click animation đang chạy trên track đó → clear);
  hàng nút track `0 1 2 3`; controls track active: Speed (select 0.25/0.5/1/1.5/2),
  Mix (number giây, dùng cho lần set tiếp), Repeat (loop), và với track >0:
  Alpha (range 0..1), Hold Previous (checkbox), Additive (checkbox);
  toggle **Show bones** (renderer viewFilters bones.visible qua setViewFilters).
- Mixer instance trong ref; rebuild khi revision đổi (doc thay đổi) giữ
  track assignments nếu animation còn tồn tại.

## 3. Ghosting config

- Store: `ghostConfig: { before: number; after: number; spacingFrames: number;
opacity: number }` (mặc định {2, 2, 4, 0.5}) + `setGhostConfig(patch)`.
  Editor-only.
- `Viewport.buildGhosts` dùng config: steps = -before..-1, 1..after; spacing =
  spacingFrames/30 (thay duration/12); alpha ghost = opacity (truyền vào
  RenderInput.ghosts entry — renderer đọc color; thêm alpha per ghost nếu
  renderer hỗ trợ, không thì nhân vào màu — kiểm khi thực hiện, tối thiểu:
  before/after/spacing hoạt động).
- **GhostingWindow** mini (nổi, Views ▾ mục Ghosting): 4 field + nút bật/tắt
  ghost (anim.ghost).

## 4. Kiểm chứng

1. Core mixer tests xanh (7 case) + toàn suite; pytest nguyên trạng.
2. 4 e2e xanh (không selector nào đổi).
3. Manual/screenshot: Preview mở, chạy walk trên track 0, wave alpha 0.5 track 1
   → hai chuyển động chồng; Hold Previous khi đổi animation không "dipping".
4. Ghosting window đổi before/after/spacing → viewport onion-skin đổi theo.
5. Docs: CLAUDE.md Phase 18 done; PLAN.md row 18 ✅ + ghi chú "Playback view gộp
   vào transport (P17) + Preview".

## 5. Không làm

- Parity chính xác AnimationState runtime (xấp xỉ lerp cho preview).
- Deform/attachment/draworder/event trong mixer; audio; lưu track setup vào file.
- Playback view riêng.
