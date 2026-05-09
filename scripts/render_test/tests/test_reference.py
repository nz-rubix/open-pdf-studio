from pathlib import Path
import pytest
from PIL import Image
from render_test.reference import render_with_pymupdf

FIXTURE = Path(__file__).parent / "fixtures" / "tiny.pdf"


def test_renders_at_target_width():
    img = render_with_pymupdf(FIXTURE, page_index=0, width=400)
    assert isinstance(img, Image.Image)
    assert img.width == 400
    # source is 200x300 → 400-wide should produce ~600 px tall
    assert 595 <= img.height <= 605


def test_rejects_negative_page():
    with pytest.raises(ValueError):
        render_with_pymupdf(FIXTURE, page_index=-1, width=400)


def test_rejects_out_of_range_page():
    with pytest.raises(IndexError):
        render_with_pymupdf(FIXTURE, page_index=99, width=400)


def test_returns_rgb_mode():
    img = render_with_pymupdf(FIXTURE, page_index=0, width=200)
    assert img.mode == "RGB"


def test_rejects_zero_width():
    with pytest.raises(ValueError):
        render_with_pymupdf(FIXTURE, page_index=0, width=0)
