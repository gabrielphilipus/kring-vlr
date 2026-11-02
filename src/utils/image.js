export function calculateScaledDimensions(width, height, maxSize = 1200) {
  if (
    !width ||
    !height ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return { width: 0, height: 0, ratio: 1 };
  }
  const maxDimension = Math.max(width, height);
  const ratio = Math.min(1, maxSize / maxDimension);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    ratio,
  };
}

export async function compressImage(file, maxSize = 1200, quality = 0.76) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      reject(new Error('Selecione um arquivo de imagem.'));
      return;
    }
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const { width, height } = calculateScaledDimensions(
        image.width,
        image.height,
        maxSize
      );
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(sourceUrl);
        reject(new Error('Não foi possível inicializar o canvas 2D.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(sourceUrl);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error('Não foi possível abrir essa imagem.'));
    };
    image.src = sourceUrl;
  });
}
