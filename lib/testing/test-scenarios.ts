import { TestScenario } from './types';

const basicHTMLTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test App</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
        }
        nav {
            background: #333;
            color: white;
            padding: 1rem;
        }
        nav ul {
            list-style: none;
            display: flex;
            gap: 2rem;
        }
        nav a {
            color: white;
            text-decoration: none;
        }
        main {
            padding: 2rem;
        }
    </style>
</head>
<body>
    <nav>
        <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#services">Services</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    <main>
        <h1>Welcome to Test App</h1>
        <p>This is a test application for validating code generation.</p>
    </main>
    <script>
        // console.log('App loaded');
    </script>
</body>
</html>`;

const basicCSSFile = `/* Additional styles */
.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
}

.btn {
    display: inline-block;
    padding: 10px 20px;
    background: #007bff;
    color: white;
    text-decoration: none;
    border-radius: 5px;
    border: none;
    cursor: pointer;
}

.btn:hover {
    background: #0056b3;
}`;

const basicJSFile = `
document.addEventListener('DOMContentLoaded', function() {
    
    const navLinks = document.querySelectorAll('nav a');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            // console.log('Navigating to:', this.getAttribute('href'));
        });
    });
});`;

export const testScenarios: TestScenario[] = [
  // UI Component Tests
  {
    id: 'ui-hamburger-menu',
    name: 'Add hamburger menu to navbar',
    category: 'ui',
    prompt: 'Add a mobile hamburger menu to the navbar. The hamburger should appear on screens smaller than 768px and toggle the navigation menu visibility when clicked.',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/styles.css': basicCSSFile,
      '/script.js': basicJSFile
    },
    expectedElements: [
      '.hamburger'
    ],
    expectedPatterns: [
      /hamburger|menu-toggle|mobile-menu/i,
      /@media.*max-width.*768px/,
      /addEventListener.*click/
    ]
  },
  
  {
    id: 'ui-modal-dialog',
    name: 'Create modal dialog',
    category: 'ui',
    prompt: 'Create a modal dialog that can be opened with a button click. The modal should have a close button and clicking outside the modal should also close it.',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/styles.css': basicCSSFile,
      '/script.js': basicJSFile
    },
    expectedElements: [
      '.modal',
      '.modal-content'
    ],
    expectedPatterns: [
      /modal/i,
      /display:\s*(none|block|flex)/,
      /addEventListener.*click/,
      /close|dismiss/i
    ]
  },
  
  {
    id: 'ui-contact-form',
    name: 'Add contact form with validation',
    category: 'ui',
    prompt: 'Add a contact form with fields for name, email, and message. Include client-side validation for required fields and email format.',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/styles.css': basicCSSFile,
      '/script.js': basicJSFile
    },
    expectedElements: [
      'form',
      'input[type="text"]',
      'input[type="email"]',
      'textarea',
      'button[type="submit"]'
    ],
    expectedPatterns: [
      /<form/i,
      /input.*type="email"/i,
      /textarea/i,
      /required/i,
      /validation|validate/i
    ]
  },
  
  {
    id: 'ui-dropdown-menu',
    name: 'Create dropdown menu',
    category: 'ui',
    prompt: 'Create a dropdown menu for the navigation. When hovering over "Services" link, show a dropdown with options: Web Design, Development, and Consulting.',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/styles.css': basicCSSFile,
      '/script.js': basicJSFile
    },
    expectedElements: [
      '.dropdown'
    ],
    expectedPatterns: [
      /dropdown/i,
      /hover|mouseenter|mouseover/i,
      /Web Design[\s\S]*Development[\s\S]*Consulting/i
    ]
  },
  
  {
    id: 'ui-image-carousel',
    name: 'Create image carousel',
    category: 'ui',
    prompt: 'Create an image carousel/slider with next and previous buttons. It should display one image at a time and cycle through 3 placeholder images.',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/styles.css': basicCSSFile,
      '/script.js': basicJSFile
    },
    expectedElements: [
      '.carousel'
    ],
    expectedPatterns: [
      /carousel|slider/i,
      /prev|previous/i,
      /next/i,
      /addEventListener.*click/
    ]
  },
  
  // Style Tests
  {
    id: 'style-background-gradient',
    name: 'Change background to gradient',
    category: 'style',
    prompt: 'Change the body background to a linear gradient from #ff8c42 to #e65100',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/styles.css': basicCSSFile
    },
    expectedPatterns: [
      /linear-gradient/i,
      /#ff8c42/i,
      /#e65100/i
    ]
  },
  
  {
    id: 'style-dark-mode',
    name: 'Add dark mode toggle',
    category: 'style',
    prompt: 'Add a dark mode toggle button that switches the entire page between light and dark themes. Store the preference in localStorage.',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/styles.css': basicCSSFile,
      '/script.js': basicJSFile
    },
    expectedElements: [
      '.dark-mode-toggle',
      '#theme-toggle',
      '.theme-switch'
    ],
    expectedPatterns: [
      /dark-mode|dark-theme/i,
      /localStorage/,
      /toggle|switch/i
    ]
  },
  
  {
    id: 'style-responsive-grid',
    name: 'Create responsive grid layout',
    category: 'style',
    prompt: 'Create a responsive grid layout with 3 columns on desktop, 2 on tablet, and 1 on mobile. Add 6 card items to demonstrate the layout.',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/styles.css': basicCSSFile
    },
    expectedPatterns: [
      /grid|flex/i,
      /@media/,
      /card/i,
      /column/i
    ]
  },
  
  // JavaScript Tests
  {
    id: 'js-fetch-api',
    name: 'Add API fetch functionality',
    category: 'javascript',
    prompt: 'Add a button that fetches data from https://jsonplaceholder.typicode.com/users and displays the user names in a list.',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/script.js': basicJSFile
    },
    expectedPatterns: [
      /fetch/i,
      /jsonplaceholder/i,
      /async|then/i,
      /addEventListener.*click/
    ]
  },
  
  {
    id: 'js-countdown-timer',
    name: 'Create countdown timer',
    category: 'javascript',
    prompt: 'Create a countdown timer that counts down from 60 seconds and displays the remaining time. Include start, stop, and reset buttons.',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/script.js': basicJSFile
    },
    expectedElements: [
      '#timer',
      '.timer-display',
      '.countdown'
    ],
    expectedPatterns: [
      /setInterval|setTimeout/i,
      /clearInterval|clearTimeout/i,
      /start|stop|reset/i,
      /countdown|timer/i
    ]
  },
  
  // Complex Features (Start with one)
  {
    id: 'complex-todo-list',
    name: 'Build a todo list application',
    category: 'complex',
    prompt: 'Build a todo list application with the ability to add tasks, mark them as complete, delete tasks, and filter by all/active/completed. Store tasks in localStorage.',
    setupFiles: {
      '/index.html': basicHTMLTemplate,
      '/styles.css': basicCSSFile,
      '/script.js': basicJSFile
    },
    expectedElements: [
      'input',
      'button',
      '.todo-item',
      '.todo-list'
    ],
    expectedPatterns: [
      /todo/i,
      /localStorage/,
      /add|delete|remove/i,
      /complete|done|finished/i,
      /filter/i
    ],
    timeout: 60000 // Longer timeout for complex features
  }
];

// Get scenarios by category
export function getScenariosByCategory(category: string): TestScenario[] {
  return testScenarios.filter(s => s.category === category);
}

// Get scenario by ID
export function getScenarioById(id: string): TestScenario | undefined {
  return testScenarios.find(s => s.id === id);
}
