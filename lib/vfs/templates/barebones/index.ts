import { ProjectTemplate } from '../../project-templates';

export const BAREBONES_PROJECT_TEMPLATE: ProjectTemplate = {
  name: 'Barebones Project',
  description: 'A minimal starting template',
  directories: ['/styles', '/scripts', '/templates'],
  files: [
    {
      path: '/index.html',
      content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Project</title>
    <link rel="stylesheet" href="/styles/style.css">
</head>
<body>
    {{> welcome-card}}

    <script src="/scripts/main.js"></script>
</body>
</html>`
    },
    {
      path: '/styles/style.css',
      content: `/*
 * Your project styles start here.
 * Use this file to customize typography, layout, and colors.
 */

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  margin: 0;
  padding: 2rem;
  background: #f9fafb;
  color: #0f172a;
}

h1 {
  font-size: 2.25rem;
  margin-bottom: 0.5rem;
}

p {
  font-size: 1rem;
  line-height: 1.6;
}

.welcome-card {
  /* Component styles can be added here */
}
`
    },
    {
      path: '/scripts/main.js',
      content: `// Welcome to your project!
// Use this file to add interactivity to your pages.

document.addEventListener('DOMContentLoaded', () => {
  console.log('Project ready. Happy building!');
});
`
    },
    {
      path: '/templates/welcome-card.hbs',
      content: `<div class="welcome-card">
    <h1>{{title}}</h1>
    <p>{{message}}</p>
</div>`
    },
    {
      path: '/data.json',
      content: `{
  "title": "Welcome",
  "message": "Start building your website!"
}`
    }
  ]
};