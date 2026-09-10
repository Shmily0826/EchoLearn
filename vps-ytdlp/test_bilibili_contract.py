"""Bilibili caption/part contract tests.

All provider and CDN calls are mocked. These tests protect the API-direct
multi-part selection boundary without invoking ASR or Groq.
"""

import io
import json
import os
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
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


class _Response:
    def __init__(self, payload, status=200):
        self.status = status
        self._body = json.dumps(payload).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class _Opener:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


def _wbi_nav_payload():
    img_key = "imgkey" + "a" * 26
    sub_key = "subkey" + "b" * 26
    return {
        "code": 0,
        "data": {"wbi_img": {
            "img_url": f"https://i0.hdslb.com/bfs/wbi/{img_key}.png",
            "sub_url": f"https://i0.hdslb.com/bfs/wbi/{sub_key}.png",
        }},
    }


def _wbi_detail_payload():
    view = view_payload()
    return {
        "code": 0,
        "data": {"View": {
            "title": view["title"],
            "owner": {"name": view["owner"]},
            "duration": view["duration"],
            "pages": [
                {"page": page["index"], "cid": page["cid"],
                 "part": page["title"], "duration": page["duration"]}
                for page in view["pages"]
            ],
        }},
    }


def _cookie_file(directory, content=None):
    path = os.path.join(directory, "cookies.txt")
    with open(path, "w", encoding="utf-8") as stream:
        stream.write(content or (
            "# Netscape HTTP Cookie File\n"
            ".bilibili.com\tTRUE\t/\tFALSE\t2147483647\tSESSDATA\tcookie-value\n"
        ))
    return path


class BilibiliViewRecoveryTests(unittest.TestCase):
    def setUp(self):
        main._BILI_VIEW_CACHE.clear()

    def tearDown(self):
        main._BILI_VIEW_CACHE.clear()

    def test_unsigned_success_returns_without_wbi(self):
        response = _Response({"code": 0, "data": {
            "title": "Multipart test", "owner": {"name": "Uploader"},
            "duration": 30, "pages": [
                {"page": 1, "cid": 101, "part": "Part one", "duration": 10},
            ],
        }})
        with patch.object(main, "_urlopen_no_proxy", return_value=response), patch.object(
            main, "_bilibili_wbi_view"
        ) as recovery:
            result = main._bilibili_view(BVID)

        self.assertEqual(result["title"], "Multipart test")
        recovery.assert_not_called()

    def test_http_or_json_412_runs_one_wbi_sequence(self):
        first_responses = [
            urllib.error.HTTPError(
                "https://api.bilibili.com/x/web-interface/view", 412,
                "Precondition Failed", {}, io.BytesIO(b"{}")
            ),
            _Response({"code": -412, "message": "risk control"}),
        ]
        for first in first_responses:
            with self.subTest(first=type(first).__name__):
                main._BILI_VIEW_CACHE.clear()
                with tempfile.TemporaryDirectory() as directory:
                    cookie_path = _cookie_file(directory)
                    opener = _Opener([_Response(_wbi_nav_payload()), _Response(_wbi_detail_payload())])
                    unsigned_side_effect = first if isinstance(first, BaseException) else [first]
                    with patch.object(main, "YTDLP_COOKIES", cookie_path), patch.object(
                        main, "_urlopen_no_proxy", side_effect=unsigned_side_effect
                    ) as unsigned, patch.object(
                        main.urllib.request, "build_opener", return_value=opener
                    ) as build_opener, patch.object(main.time, "time", return_value=1700000000):
                        result = main._bilibili_view(BVID)

                self.assertEqual(result, view_payload())
                self.assertEqual(unsigned.call_count, 1)
                self.assertEqual(len(opener.requests), 2)
                self.assertEqual(
                    opener.requests[0][0].full_url,
                    "https://api.bilibili.com/x/web-interface/nav",
                )
                detail_request = opener.requests[1][0]
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(detail_request.full_url).query)
                self.assertEqual(query["bvid"], [BVID])
                self.assertEqual(query["platform"], ["web"])
                self.assertEqual(query["wts"], ["1700000000"])
                self.assertEqual(query["w_rid"], ["b0cf8c310457de36c9861e0e583455fe"])
                self.assertNotIn("imgkey", detail_request.full_url)
                self.assertNotIn("subkey", detail_request.full_url)
                self.assertEqual(detail_request.headers.get("User-agent"), main._BILI_UA)
                self.assertEqual(detail_request.headers.get("Referer"), main._BILI_REFERER)
                self.assertEqual(detail_request.headers.get("Origin"), "https://www.bilibili.com")
                self.assertEqual(
                    detail_request.headers.get("Accept"), "application/json, text/plain, */*"
                )
                handlers = build_opener.call_args.args
                self.assertTrue(any(isinstance(handler, urllib.request.ProxyHandler) for handler in handlers))
                self.assertTrue(any(isinstance(handler, urllib.request.HTTPCookieProcessor) for handler in handlers))

    def test_explicit_412_with_missing_or_unreadable_cookie_does_not_loop(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [
                os.path.join(directory, "missing.txt"),
                _cookie_file(directory, "not a Netscape cookie jar\n"),
            ]
            for cookie_path in paths:
                with self.subTest(cookie_path=cookie_path):
                    with patch.object(main, "YTDLP_COOKIES", cookie_path), patch.object(
                        main, "_urlopen_no_proxy", side_effect=urllib.error.HTTPError(
                            "https://api.bilibili.com/x/web-interface/view", 412,
                            "Precondition Failed", {}, io.BytesIO(b"{}")
                        )
                    ) as unsigned, patch.object(main.urllib.request, "build_opener") as build_opener:
                        self.assertIsNone(main._bilibili_view(BVID))
                    self.assertEqual(unsigned.call_count, 1)
                    build_opener.assert_not_called()

    def test_wbi_nav_or_detail_failure_returns_none_without_unsigned_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            cookie_path = _cookie_file(directory)
            cases = [
                [_Response({"code": -1})],
                [_Response(_wbi_nav_payload()), _Response({"code": -1})],
            ]
            for responses in cases:
                with self.subTest(response_count=len(responses)):
                    opener = _Opener(responses)
                    with patch.object(main, "YTDLP_COOKIES", cookie_path), patch.object(
                        main, "_urlopen_no_proxy", side_effect=urllib.error.HTTPError(
                            "https://api.bilibili.com/x/web-interface/view", 412,
                            "Precondition Failed", {}, io.BytesIO(b"{}")
                        )
                    ) as unsigned, patch.object(
                        main.urllib.request, "build_opener", return_value=opener
                    ):
                        self.assertIsNone(main._bilibili_view(BVID))
                    self.assertEqual(unsigned.call_count, 1)
                    self.assertEqual(len(opener.requests), len(responses))

    def test_non_412_json_failure_keeps_three_unsigned_attempts(self):
        responses = [_Response({"code": -1}) for _ in range(3)]
        with patch.object(main, "_urlopen_no_proxy", side_effect=responses) as unsigned, patch.object(
            main.time, "sleep"
        ) as sleep, patch.object(main, "_bilibili_wbi_view") as recovery:
            self.assertIsNone(main._bilibili_view(BVID))

        self.assertEqual(unsigned.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [0.75, 1.5])
        recovery.assert_not_called()


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
