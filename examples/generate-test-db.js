const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'test.db');

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(100) NOT NULL UNIQUE,
      phone VARCHAR(20) UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      nickname VARCHAR(100),
      avatar_url VARCHAR(255),
      status TINYINT DEFAULT 1,
      user_type TINYINT DEFAULT 1,
      last_login_at DATETIME,
      last_login_ip VARCHAR(45),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      name VARCHAR(100) NOT NULL,
      level TINYINT DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      status TINYINT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    )
  `);

  db.run(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      sku VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      original_price INTEGER,
      stock INTEGER DEFAULT 0,
      sales_count INTEGER DEFAULT 0,
      status TINYINT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (seller_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no VARCHAR(32) NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      total_amount INTEGER NOT NULL,
      discount_amount INTEGER DEFAULT 0,
      payment_amount INTEGER NOT NULL,
      shipping_address TEXT NOT NULL,
      status TINYINT DEFAULT 1,
      payment_method TINYINT,
      payment_time DATETIME,
      shipping_time DATETIME,
      completed_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name VARCHAR(200) NOT NULL,
      product_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  db.run(`
    CREATE TABLE user_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      recipient_name VARCHAR(50) NOT NULL,
      recipient_phone VARCHAR(20) NOT NULL,
      province VARCHAR(50) NOT NULL,
      city VARCHAR(50) NOT NULL,
      district VARCHAR(50) NOT NULL,
      detail_address VARCHAR(200) NOT NULL,
      is_default TINYINT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`CREATE INDEX idx_products_category ON products(category_id)`);
  db.run(`CREATE INDEX idx_products_seller ON products(seller_id)`);
  db.run(`CREATE INDEX idx_products_status ON products(status)`);
  db.run(`CREATE INDEX idx_orders_user ON orders(user_id)`);
  db.run(`CREATE INDEX idx_orders_status ON orders(status)`);
  db.run(`CREATE INDEX idx_order_items_order ON order_items(order_id)`);
  db.run(`CREATE UNIQUE INDEX idx_users_username ON users(username)`);
  db.run(`CREATE UNIQUE INDEX idx_users_email ON users(email)`);

  const stmt1 = db.prepare('INSERT INTO users (username, email, password_hash, nickname, status, user_type) VALUES (?, ?, ?, ?, ?, ?)');
  stmt1.run('admin', 'admin@example.com', 'hash_admin', '系统管理员', 1, 3);
  stmt1.run('seller1', 'seller1@example.com', 'hash_seller1', '优品店铺', 1, 2);
  stmt1.run('user1', 'user1@example.com', 'hash_user1', '小明', 1, 1);
  stmt1.finalize();

  const stmt2 = db.prepare('INSERT INTO categories (parent_id, name, level, sort_order) VALUES (?, ?, ?, ?)');
  stmt2.run(null, '电子产品', 1, 1);
  stmt2.run(null, '服装鞋帽', 1, 2);
  stmt2.run(1, '手机数码', 2, 1);
  stmt2.run(1, '电脑办公', 2, 2);
  stmt2.finalize();

  const stmt3 = db.prepare('INSERT INTO products (category_id, seller_id, sku, name, price, original_price, stock, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  stmt3.run(3, 2, 'SKU001', 'iPhone 15 Pro Max', 999900, 1099900, 100, 'Apple 最新款旗舰手机，搭载 A17 Pro 芯片');
  stmt3.run(4, 2, 'SKU002', 'MacBook Pro 14英寸', 1499900, 1699900, 50, 'Apple 专业笔记本电脑，M3 Pro 芯片');
  stmt3.finalize();

  console.log('✅ 测试数据库已生成: ' + dbPath);
  console.log('');
  console.log('生成示例数据:');
  console.log('  - users 表: 3 条记录');
  console.log('  - categories 表: 4 条记录');
  console.log('  - products 表: 2 条记录');
  console.log('');
  console.log('使用示例:');
  console.log('  npm run dev -- generate -t sqlite -c examples/test.db -o examples/dictionary.html -f html --business-config examples/business-config.json');
  console.log('  npm run dev -- generate -t sqlite -c examples/test.db -o examples/dictionary.md -f markdown');
  console.log('  npm run dev -- generate -t sqlite -c examples/test.db -o examples/dictionary.json -f json');
});

db.close();
