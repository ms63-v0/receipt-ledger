/**
 * 업로드 전에 영수증 사진을 리사이즈·JPEG 압축한다.
 * - 긴 변 1600px, 품질 0.8 → 보통 150~400KB (Supabase 무료 1GB에 수천 장)
 * - iOS Safari는 <input type="file">로 고른 HEIC를 디코딩할 수 있어 canvas를 거치면 JPEG가 된다.
 */
export async function compressImage(file: Blob, maxDim = 1600, quality = 0.8): Promise<Blob> {
  const source = await loadImage(file);
  const scale = Math.min(1, maxDim / Math.max(source.width, source.height));
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리할 수 없습니다.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source.el, 0, 0, w, h);
  source.cleanup();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("이미지 압축에 실패했습니다.");
  return blob;
}

async function loadImage(file: Blob): Promise<{
  el: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { el: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close() };
    } catch {
      /* 아래 fallback */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => {
    URL.revokeObjectURL(url);
    throw new Error("이미지를 열 수 없습니다. JPG/PNG 사진으로 다시 시도해 주세요.");
  });
  return {
    el: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
