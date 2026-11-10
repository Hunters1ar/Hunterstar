import unittest

from proxy import PET_ROUTE, add_pet_route


class PetProxyTests(unittest.TestCase):
    def test_preserves_image_fallback_and_other_services(self):
        original = '''api.moonlightsoldiers.xyz {
    handle /ai/workers/* {
        reverse_proxy 127.0.0.1:8092
    }
}
image.hunterstar.uz {
    reverse_proxy 172.19.0.2:8000 {
        header_up X-Real-IP {remote_host}
    }
}
phone.hunterstar.uz {
    reverse_proxy 127.0.0.1:18080
}
'''
        original = original.replace('api.moonlightsoldiers.xyz {', 'api.moonlightsoldiers.xyz {' + PET_ROUTE)
        updated = add_pet_route(original)
        self.assertEqual(updated, original.replace('image.hunterstar.uz {', 'image.hunterstar.uz {' + PET_ROUTE))
        self.assertEqual(updated.count(PET_ROUTE), 2)
        self.assertIn('image.hunterstar.uz {' + PET_ROUTE, updated)
        self.assertEqual(add_pet_route(updated), updated)

    def test_missing_or_incomplete_host_is_rejected(self):
        for config in ('other.example {\n}\n', 'image.hunterstar.uz {\n'):
            with self.subTest(config=config), self.assertRaises(RuntimeError):
                add_pet_route(config)

    def test_unrecognized_existing_pet_route_is_not_overwritten(self):
        with self.assertRaises(RuntimeError):
            add_pet_route('image.hunterstar.uz {\n    handle /api/pet/* { respond 503 }\n}\n')


if __name__ == '__main__':
    unittest.main()
