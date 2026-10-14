// Recipes by use case (M5 story 5.12): people search by what they are building, not by technique.
// Each recipe names a job, lists the effects that do it, and shows one snippet to start from.
export const recipes = [
  {
    slug: 'hero-backgrounds',
    title: 'Hero backgrounds',
    blurb:
      'A full-width field behind the headline: calm enough to read over, alive enough to hold attention.',
    featured: 'aurora-veil',
    host: '.hero',
    effects: [
      'aurora-veil',
      'gradient-oklch',
      'topographic-lines',
      'dot-matrix-field',
      'grid-horizon',
      'starfield',
      'constellation',
      'grain-overlay',
    ],
  },
  {
    slug: 'card-hovers',
    title: 'Card hovers',
    blurb:
      'The small reward when the pointer lands on a card: a lift, a shadow, a trace of energy along the edge.',
    featured: 'hover-lift-shadow',
    host: '.card',
    effects: [
      'hover-lift-shadow',
      'press-ripple',
      'border-energy',
      'panel-refraction',
      'product-sheen',
      'spotlight',
      'masked-composite',
    ],
  },
  {
    slug: 'text-treatments',
    title: 'Text treatments',
    blurb:
      'Headings and body copy that arrive, shimmer or dissolve — without turning the type into an image.',
    featured: 'heading-reveal',
    host: '.headline',
    effects: [
      'heading-reveal',
      'text-shimmer',
      'text-outline-glow',
      'text-dissolve',
      'halftone-ascii',
    ],
  },
  {
    slug: 'page-transitions',
    title: 'Page transitions',
    blurb:
      'Wipes and dividers between sections, and scenes that travel with the scroll.',
    featured: 'section-wipe',
    host: '.section',
    effects: ['section-wipe', 'wave-divider', 'scroll-scene', 'image-hover', 'depth-parallax'],
  },
  {
    slug: 'loading-states',
    title: 'Loading states',
    blurb:
      'Something to look at while work finishes, that reads as progress rather than a spinner.',
    featured: 'progress-line',
    host: '.progress',
    effects: ['progress-line', 'particle-drift', 'constellation', 'light-sweep', 'dot-matrix-field'],
  },
];

export const recipeBySlug = (slug) => recipes.find((recipe) => recipe.slug === slug);
