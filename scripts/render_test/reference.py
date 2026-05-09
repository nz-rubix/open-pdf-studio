"""PyMuPDF reference renderer."""
from pathlib import Path
import fitz
from PIL import Image


def render_with_pymupdf(pdf_path: Path, page_index: int, width: int) -> Image.Image:
    if page_index < 0:
        raise ValueError(f"page_index must be >= 0, got {page_index}")
    if width <= 0:
        raise ValueError(f"width must be > 0, got {width}")

    doc = fitz.open(str(pdf_path))
    try:
        if page_index >= doc.page_count:
            raise IndexError(
                f"page_index {page_index} out of range (max {doc.page_count - 1})"
            )
        page = doc[page_index]
        zoom = width / page.rect.width
        pix = page.get_pixmap(
            matrix=fitz.Matrix(zoom, zoom),
            alpha=False,
            colorspace=fitz.csRGB,
        )
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    finally:
        doc.close()
