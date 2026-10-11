"""Cosmic Radio archival data pipeline.

Each module rebuilds one archive file in ``app/public/data/`` from its real
upstream source, or — with ``--offline`` — from the published values embedded
in the module (with citations). Run ``python -m pipeline.build_all --offline``.
"""
