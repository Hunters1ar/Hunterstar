"""Add the pet route to Hunterella's existing Hunterstar HTTPS host."""
import re

PET_HOST = 'image.hunterstar.uz'
PET_ROUTE = '''
    # Portfolio companion: its own API and Hermes 3 model on port 8090.
    handle /api/pet/* {
        reverse_proxy 127.0.0.1:8091 {
            flush_interval -1
            header_up X-Real-IP {remote_host}
            header_up Authorization ""
        }
    }
'''


def add_pet_route(config):
    """Preserve the site's fallback and every unrelated Caddy route verbatim."""
    site = re.search(r'(?m)^' + re.escape(PET_HOST) + r'\s*\{', config)
    if not site:
        raise RuntimeError(f'Could not find the existing {PET_HOST} site.')
    opening = site.end() - 1
    depth = 0
    for index in range(opening, len(config)):
        if config[index] == '{':
            depth += 1
        elif config[index] == '}':
            depth -= 1
            if depth == 0:
                body = config[opening + 1:index]
                if PET_ROUTE in body:
                    return config
                if '/api/pet/' in body:
                    raise RuntimeError('An unrecognized pet route already exists; inspect it before changing it.')
                return config[:opening + 1] + PET_ROUTE + config[opening + 1:]
    raise RuntimeError(f'Could not identify the end of the {PET_HOST} site.')
