"""Bilibili caption/part contract tests.

All provider and CDN calls are mocked. These tests protect the API-direct
multi-part selection boundary without invoking ASR or Groq.
"""

import unittest
from unittest.mock import patch

import main


BVID = "BV1xx411c7mD"
VIDEO_URL = f"https://www.bilibili.com/video/{BVID}"


def view_payload():
    return {
        "title": "Multipart test",
        "owner": "Uploader",
        "duration": 30,
        "pages": [
            {"index": 1, "cid": 101, "title": "Part one", "duration": 10},
            {"index": 2, "cid": 202, "title": "Part two", "duration": 20},
        ],
    }


class BilibiliPartContractTests(unittest.TestCase):
    def test_cid_selection_defaults_only_when_part_is_absent(self):
        view = view_payload()

        self.assertEqual(main._bilibili_cid_for_part(view, None), 101)
        self.assertEqual(main._bilibili_cid_for_part(view, 1), 101)
        self.assertEqual(main._bilibili_cid_for_part(view, 2), 202)
        self.assertIsNone(main._bilibili_cid_for_part(view, 3))
        self.assertIsNone(main._bilibili_cid_for_part(view, 999))

    def test_asr_out_of_range_part_is_clear_and_never_calls_part_one(self):
        with patch.object(main, "_resolve_bilibili_url", return_value=VIDEO_URL), patch.object(
            main, "_bilibili_view", return_value=view_payload()
        ), patch.object(main, "_bilibili_playurl") as playurl:
            with self.assertRaises(main.HTTPException) as raised:
                main._bilibili_asr(VIDEO_URL, 3)

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "Invalid Bilibili part number")
        playurl.assert_not_called()

    def test_audio_out_of_range_part_is_clear_and_never_calls_part_one(self):
        with patch.object(main, "_resolve_bilibili_url", return_value=VIDEO_URL), patch.object(
            main, "_bilibili_view", return_value=view_payload()
        ), patch.object(main, "_bilibili_playurl") as playurl:
            with self.assertRaises(main.HTTPException) as raised:
                main._bilibili_audio(VIDEO_URL, 3, "unused.mp3")

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "Invalid Bilibili part number")
        playurl.assert_not_called()

    def test_info_honors_embedded_part_and_rejects_out_of_range_part(self):
        with patch.object(main, "_cache_get", return_value=None), patch.object(
            main, "_cache_put"
        ), patch.object(main, "_bilibili_view", return_value=view_payload()), patch.object(
            main, "_bilibili_parts", return_value={
                "partCount": 2,
                "parts": [{"index": 1, "title": "Part one"}, {"index": 2, "title": "Part two"}],
            }
        ):
            metadata = main._fetch_meta(f"{VIDEO_URL}?p=2")

        self.assertEqual(metadata["duration"], 20)
        self.assertEqual(metadata["bvid"], BVID)

        with patch.object(main, "_cache_get", return_value=None), patch.object(
            main, "_bilibili_view", return_value=view_payload()
        ):
            with self.assertRaises(main.HTTPException) as raised:
                main._fetch_meta(f"{VIDEO_URL}?p=3")

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "Invalid Bilibili part number")

    def test_bilibili_part_parser_rejects_malformed_selectors(self):
        clean, part = main._extract_part(f"{VIDEO_URL}?p=2")
        self.assertEqual(clean, VIDEO_URL)
        self.assertEqual(part, 2)

        clean, part = main._extract_part(f"{VIDEO_URL}?p=1")
        self.assertEqual(clean, VIDEO_URL)
        self.assertIsNone(part)

        for selector in ("0", "abc", "2&p=3"):
            with self.subTest(selector=selector):
                with self.assertRaises(main.HTTPException) as raised:
                    main._extract_part(f"{VIDEO_URL}?p={selector}")
                self.assertEqual(raised.exception.status_code, 400)

    def test_host_and_bvid_boundaries_are_exact(self):
        self.assertTrue(main._host_allowed(VIDEO_URL))
        self.assertFalse(main._host_allowed("https://evil-bilibili.com/video/" + BVID))
        self.assertEqual(main._extract_bvid(VIDEO_URL), BVID)
        self.assertIsNone(main._extract_bvid(VIDEO_URL + "X"))


if __name__ == "__main__":
    unittest.main()
