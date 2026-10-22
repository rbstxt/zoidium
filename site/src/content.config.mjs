import { defineCollection } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';
import { zoidiumDocs } from '../loaders/docs.mjs';

export const collections = { docs: defineCollection({ loader: zoidiumDocs(), schema: docsSchema() }) };
