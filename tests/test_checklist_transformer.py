import unittest
from app.utils.checklist_transformer import (
    clean_checklist_label,
    extract_module,
    extract_verification_points,
    extract_precondition
)


class ChecklistTransformerTest(unittest.TestCase):
    
    def test_clean_checklist_label_basic(self):
        # Normal cleaning
        raw = "TC-123_Verify_user_can_login_with_valid_credentials"
        self.assertEqual(clean_checklist_label(raw), "User can login with valid credentials")
        
        # Leading brackets and number prefixes
        raw2 = "[PROJ-T12] 42 - Verify registration form"
        self.assertEqual(clean_checklist_label(raw2), "Registration form")

    def test_clean_checklist_label_tags(self):
        # Brackets and paren status/type tags
        raw = "TC-001_[Regression]_Verify_profile_page_works_(Smoke)"
        self.assertEqual(clean_checklist_label(raw), "Profile page works")
        
        # Different tags
        raw2 = "TC-002 [Sanity] Verify balance updates [P0]"
        self.assertEqual(clean_checklist_label(raw2), "Balance updates")

    def test_clean_checklist_label_filler_verbs(self):
        # Test various filler verbs case-insensitively
        self.assertEqual(clean_checklist_label("Verify dashboard loads"), "Dashboard loads")
        self.assertEqual(clean_checklist_label("check that session is valid"), "Session is valid")
        self.assertEqual(clean_checklist_label("Ensure user is redirected"), "User is redirected")
        self.assertEqual(clean_checklist_label("Validate transaction state"), "Transaction state")
        self.assertEqual(clean_checklist_label("To check email receipt works"), "Email receipt works")

    def test_clean_checklist_label_os_browser_noise(self):
        # Trailing browser/OS noise
        raw = "TC-45_Verify_settings_page_on_Chrome_v115_macOS"
        self.assertEqual(clean_checklist_label(raw), "Settings page")
        
        raw2 = "Verify logout works in Chrome browser"
        # Since 'in Chrome browser' starts with 'in Chrome', it should strip it
        self.assertEqual(clean_checklist_label(raw2), "Logout works")

    def test_clean_checklist_label_truncation(self):
        # Long label should truncate at a word boundary within 120 characters
        raw = "Verify that this is a very long test case name that contains a lot of descriptive information and needs to be truncated at a word boundary"
        cleaned = clean_checklist_label(raw)
        self.assertTrue(len(cleaned) <= 120)
        self.assertTrue(cleaned.startswith("This is a very long test case name"))
        # Verify it doesn't end with a partial word
        self.assertEqual(cleaned[-1].isalnum() or cleaned[-1] in {'.', ')', ']'}, True)

    def test_clean_checklist_label_conjunctions(self):
        raw = "Verify currency margin INR converison when fixed_conversion_factor goes up during the edit order if the margin is reduced by the user while editing then Exisiting fixed_conversion_factor should be used"
        self.assertEqual(clean_checklist_label(raw), "Currency margin INR converison when fixed conversion factor goes up during the edit order if the margin is reduced by")

    def test_clean_checklist_label_fallback(self):
        # Empty/None check
        self.assertEqual(clean_checklist_label(""), "Untitled checklist item")
        self.assertEqual(clean_checklist_label("   "), "Untitled checklist item")
        
        # When cleaning strips everything
        # e.g., name is only "TC-123 Verify"
        self.assertEqual(clean_checklist_label("TC-123 [Regression] Verify"), "[Regression] Verify")

    def test_clean_checklist_label_capsule(self):
        self.assertEqual(clean_checklist_label("Verify 100% capsule name integrity"), "100% capsule name integrity")

    def test_extract_module_basic(self):
        # Deeply nested path
        path = "Web > Functional > Payments > Checkout Flow"
        self.assertEqual(extract_module(path), "Payments › Checkout Flow")
        
        # Path with slash separators
        path2 = "API/Security/OAuth"
        self.assertEqual(extract_module(path2), "Security › OAuth")

    def test_extract_module_generic_skips(self):
        # Skip generic terms
        path = "Web > Functional > Regression > Login > Authentication"
        self.assertEqual(extract_module(path), "Login › Authentication")

    def test_extract_module_all_generic_fallback(self):
        # If everything in the path is generic, fall back to last segment
        path = "Web > Functional > Sanity > Regression"
        self.assertEqual(extract_module(path), "Regression")
        
        # Empty/None fallback
        self.assertEqual(extract_module(None), "Uncategorized")
        self.assertEqual(extract_module(""), "Uncategorized")

    def test_extract_verification_points_flat_and_inline(self):
        # Test flat step structure
        steps = [
            {"description": "Open login page", "expectedResult": "Page displays fields"},
            {"description": "Enter credentials", "expectedResult": "Submit button is enabled"}
        ]
        points = extract_verification_points(steps)
        self.assertEqual(points, [
            "Open login page → Page displays fields",
            "Enter credentials → Submit button is enabled"
        ])
        
        # Test inline step structure
        nested_steps = [
            {"inline": {"description": "1. Open app", "expectedResult": "Home loads"}},
            {"inline": {"description": "2. Click profile", "expectedResult": ""}}
        ]
        points2 = extract_verification_points(nested_steps)
        self.assertEqual(points2, [
            "Open app → Home loads",
            "Click profile"
        ])

    def test_extract_verification_points_clean_html(self):
        # Clean HTML tags and unescape
        steps = [
            {"description": "<p>Open <b>App</b> &amp; click &quot;Login&quot;</p>", "expectedResult": "<div>Redirected</div>"}
        ]
        self.assertEqual(extract_verification_points(steps), [
            "Open App & click \"Login\" → Redirected"
        ])

    def test_extract_verification_points_dedup_and_cap(self):
        # Deduplication and capping at 10 items
        steps = [
            {"description": "Step 1", "expectedResult": "Result 1"},
            {"description": "step 1", "expectedResult": "result 1"}, # duplicate (case-insensitive)
            {"description": "Step 2", "expectedResult": "Result 2"},
            {"description": "Step 3", "expectedResult": "Result 3"},
            {"description": "Step 4", "expectedResult": "Result 4"},
            {"description": "Step 5", "expectedResult": "Result 5"},
            {"description": "Step 6", "expectedResult": "Result 6"},
            {"description": "Step 7", "expectedResult": "Result 7"},
            {"description": "Step 8", "expectedResult": "Result 8"},
            {"description": "Step 9", "expectedResult": "Result 9"},
            {"description": "Step 10", "expectedResult": "Result 10"},
            {"description": "Step 11", "expectedResult": "Result 11"}, # capped out
        ]
        points = extract_verification_points(steps)
        self.assertEqual(len(points), 10)
        self.assertEqual(points[0], "Step 1 → Result 1")
        self.assertEqual(points[-1], "Step 10 → Result 10")

    def test_extract_precondition(self):
        # Basic extraction from precondition
        snap = {"precondition": "User must have <p>active account</p>"}
        self.assertEqual(extract_precondition(snap), "User must have active account")
        
        # Extraction from objective if precondition is missing
        snap2 = {"objective": "Verify password reset link is sent"}
        self.assertEqual(extract_precondition(snap2), "Verify password reset link is sent")
        
        # Long precondition truncation
        long_precond = "A" * 350
        snap3 = {"precondition": long_precond}
        extracted = extract_precondition(snap3)
        self.assertEqual(len(extracted), 300)
        self.assertTrue(extracted.endswith("…"))
        
        # Empty/None preconditions
        self.assertIsNone(extract_precondition(None))
        self.assertIsNone(extract_precondition({}))

    def test_clean_checklist_label_gherkin(self):
        # Full Gherkin style (Given-When-Then)
        raw = "Given BTCUSDT position is under liquidation, When user places an order on ETHUSDT, Then ETHUSDT order must be accepted without restriction."
        self.assertEqual(clean_checklist_label(raw), "ETHUSDT order must be accepted without restriction")

        # Gherkin style with uppercase acronyms and underscores
        raw2 = "Given a user has USDT wallet with total_balance >= Y(Configured), When fetching user_product_config, Then active_futures_wallet_currency is set to USDT."
        self.assertEqual(clean_checklist_label(raw2), "Active futures wallet currency is set to USDT")

        # Given only style (no When/Then)
        raw3 = "Given a single active USDT long position is visible"
        self.assertEqual(clean_checklist_label(raw3), "Single active USDT long position is visible")


if __name__ == "__main__":
    unittest.main()
