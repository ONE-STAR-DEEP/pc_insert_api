import { config } from "../lib/mssqlPool.js";
import sql from "mssql";
import { pool } from "../lib/mysqlPool.js";

export async function getData(Vno) {
  const conn = await pool.getConnection();

  try {
    await sql.connect(config);

    let lastVno;
    if (Vno) {
      lastVno = Vno;
    } else {
      let [lastInserted] = await conn.query(
        `SELECT Vno FROM Salepurchase1 ORDER BY Vno DESC LIMIT 1;`
      );
      lastVno = lastInserted?.[0]?.Vno;
    }

    let conditions = `WHERE Salepurchase1.Vtyp ='S1'`;

    conditions += ` AND Salepurchase1.Vdt >= DATEADD(day, -10, GETDATE())`;

    if (lastVno !== undefined) {
      conditions += ` AND Salepurchase1.Vno > ${lastVno}`;
    }

    const result = await sql.query(`
      SELECT Acm.name, Acm.address, Acm.address1, Acm.address2,
          Acm.telephone as 'Tel',
          Acm.GSTNo as 'GST No.',
          Acm.DLNO, Acm.DLNO1,
          Salepurchase1.GSTVno AS 'Bill No',
          Salepurchase1.Vno AS 'VNo',
          Salepurchase1.Vtyp AS 'Vtyp',
          Salepurchase1.Vdt AS 'Dated',
          Salepurchase1.NoOfItem as 'No Of Items',
          Salepurchase1.Uid as 'Made By',
          Salepurchase1.Ouid as 'Print By',
          Salepurchase1.mTime as 'Make Time',
          Salepurchase1.Amt01 + Salepurchase1.disamtit as 'Gross Amt',
          Salepurchase1.disamtit as 'Disc. Amt',
          Salepurchase1.Amt01 as 'Taxable Amt.',
          Salepurchase1.Taxamt as 'Tax Amt',
          Salepurchase1.Amt01 + Salepurchase1.Taxamt as 'Net Amount',
          Salepurchase1.Amt01 + Salepurchase1.Taxamt + Salepurchase1.Rndamt as 'Inv Amt'
      FROM Salepurchase1
      INNER JOIN Acm ON Acm.code = Salepurchase1.Acno
      ${conditions}
      ORDER BY Salepurchase1.Vno ASC
    `);

    return result.recordset;

  } catch (err) {
    console.error(err);
    return [];
  } finally {
    if (conn) conn.release();
  }
}

export async function getBillByBillNo(VNo) {
  try {
    await sql.connect(config);

    const result = await sql.query(`
      SELECT Acm.name, Acm.address, Acm.address1, Acm.address2,
          Acm.telephone as 'Tel',
          Acm.GSTNo as 'GST No.',
          Acm.DLNO, Acm.DLNO1,
          Salepurchase1.GSTVno AS 'Bill No',
          CONVERT(VARCHAR(10), Salepurchase1.Vdt, 103) AS 'Dated',
          Salepurchase1.NoOfItem as 'No Of Items',
          Salepurchase1.Uid as 'Made By',
          Salepurchase1.Ouid as 'Print By',
          Salepurchase1.mTime as 'Make Time',
          Salepurchase1.Amt01 + Salepurchase1.disamtit as 'Gross Amt',
          Salepurchase1.disamtit as 'Disc. Amt',
          Salepurchase1.Amt01 as 'Taxable Amt.',
          Salepurchase1.Taxamt as 'Tax Amt',
          Salepurchase1.Amt01 + Salepurchase1.Taxamt as 'Net Amount',
          Salepurchase1.Amt01 + Salepurchase1.Taxamt + Salepurchase1.Rndamt as 'Inv Amt'
          FROM Salepurchase1
          INNER JOIN Acm ON Acm.code = Salepurchase1.Acno
          WHERE Salepurchase1.Vtyp ='S1'
          AND Salepurchase1.Vno = '${VNo}'
    `);

    return result.recordset[0];
  } catch (err) {
    console.error(err);
  }
}

export async function getInvoiceItems(VNo, Vdt) {
  try {
    await sql.connect(config);

    const sqlDate = new Date(Vdt).toISOString().slice(0, 19).replace("T", " ");
    
    const result = await sql.query(`
      SELECT Salepurchase2.Qty,
             Item.Pack as 'PACK',
             Item.Compname as 'COMPANY',
             Item.name AS 'PARTICULARS',
             Salepurchase2.HSNCode AS 'HSN CODE',
             SalePurchase2.Batch as 'Batch No.',
             SalePurchase2.expiry as 'Exp.',
             SalePurchase2.Mrp as 'MRP.',
             SalePurchase2.Ftrate as 'Rate',
             SalePurchase2.Dis as 'DIS%',
             CASE
                WHEN SalePurchase2.CGST > 0 THEN SalePurchase2.CGST
                WHEN SalePurchase2.SGST > 0 THEN SalePurchase2.SGST
                WHEN SalePurchase2.IGST > 0 THEN SalePurchase2.IGST
                ELSE 0
             END AS Tax
      FROM Salepurchase2
      INNER JOIN Item ON Item.code = SalePurchase2.Itemc
      WHERE SalePurchase2.Vtype='S1'
        AND SalePurchase2.Vno= ${VNo}
        AND Salepurchase2.Vdt >= '${sqlDate}'
      ORDER BY Item.Compname ASC
    `);

    return result.recordset;

  } catch (err) {
    console.error(err);
    return [];
  }
}

export const fetchDiscrepancyInvoices = async (
  page = 1,
  limit = 20,
  search = ""
) => {

  const conn = await pool.getConnection();

  try {
    const offset = (page - 1) * limit;

    const safeLimit = Math.min(100, Number(limit) || 10);
    const safeOffset = Math.max(0, Number(offset) || 0);

    const searchTerm = search ? `%${search}%` : `%`;

    const where = `
        WHERE 
        discrepancy = 1 
        AND
        (
          Vno LIKE ?
          OR GSTVno  LIKE ?
          OR Vtyp LIKE ?
        )
      `;

    const params = [searchTerm, searchTerm, searchTerm];

    const [rows] = await conn.execute(
      `
            SELECT 
            dpt.*,
            acm.name AS partyName,
            (dpt.Amt01 + dpt.disamtit) AS 'Gross Amt',
            (dpt.Amt01 + dpt.Taxamt + dpt.Rndamt) AS 'Inv Amt'
            FROM discrepancy_table dpt
            LEFT JOIN Acm acm ON dpt.Acno = acm.code
            ${where}
            ORDER BY dpt.inserted_at DESC
            LIMIT ${safeLimit} OFFSET ${safeOffset}
            `,
      params
    );

    const [countResult] = await conn.execute(
      `
      SELECT COUNT(*) as total
      FROM discrepancy_table
      ${where}
      `,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / safeLimit);

    return {
      success: true,
      data: rows,
      pagination: {
        total,
        totalPages,
        currentPage: page,
        limit: safeLimit,
      },
    };

  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: "Failed to fetch data",
    };
  } finally {
    conn.release();
  }
};

export const fetchInvoiceByVNo = async (VNo) => {

  const conn = await pool.getConnection();

  try {
    const [rows] = await conn.execute(
      `SELECT 
                Acm.name,
                Acm.address,
                Acm.address1,
                Acm.address2,
                Acm.telephone AS Tel,
                Acm.GSTNo AS 'GST No.',
                Acm.DLNO,
                Acm.DLNO1,
                discrepancy_table.id,
                discrepancy_table.discrepancy,
                discrepancy_table.GSTVno AS 'Bill No',
                DATE_FORMAT(discrepancy_table.Vdt, '%d/%m/%Y') AS Dated,
                discrepancy_table.NoOfItem AS 'No Of Items',
                discrepancy_table.Uid AS 'Made By',
                discrepancy_table.Ouid AS 'Print By',
                discrepancy_table.mTime AS 'Make Time',
                (discrepancy_table.Amt01 + discrepancy_table.disamtit) AS 'Gross Amt',
                discrepancy_table.disamtit AS 'Disc.Amt',
                discrepancy_table.Amt01 AS 'Taxable Amt.',
                discrepancy_table.Taxamt AS 'Tax Amt',
                (discrepancy_table.Amt01 + discrepancy_table.Taxamt) AS 'Net Amount',
                (discrepancy_table.Amt01 + discrepancy_table.Taxamt + discrepancy_table.Rndamt) AS 'Inv Amt',
                discrepancy_table.status,
                discrepancy_table.recipt
                FROM discrepancy_table
                INNER JOIN Acm ON Acm.code = discrepancy_table.Acno
                WHERE discrepancy_table.Vtyp = 'S1'
                AND discrepancy_table.Vno = ?
                LIMIT 1
                `,
      [VNo]
    );

    return {
      success: true,
      data: rows[0],
    };

  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: "Failed to fetch data",
    };
  } finally {
    conn.release();
  }
};

export const fetchInvoiceItems = async (
  VNo
) => {

  const conn = await pool.getConnection();

  try {
    const [rows] = await conn.execute(
      `SELECT
          discrepancy_items.id,
          discrepancy_items.Qty,
          Item.Pack AS 'PACK',
          Item.Compname AS 'COMPANY',
          Item.name AS 'PARTICULARS',
          discrepancy_items.HSNCode AS 'HSN CODE',
          discrepancy_items.Batch AS 'Batch No.',
          discrepancy_items.expiry AS 'Exp.',
          discrepancy_items.Mrp AS 'MRP.',
          discrepancy_items.Ftrate AS 'Rate',
          discrepancy_items.Dis AS 'DIS%',
          discrepancy_items.old_Qty AS 'old_Qty',
          CASE
          WHEN discrepancy_items.CGST > 0 THEN discrepancy_items.CGST
          WHEN discrepancy_items.SGST > 0 THEN discrepancy_items.SGST
          WHEN discrepancy_items.IGST > 0 THEN discrepancy_items.IGST
          ELSE 0
          END AS 'Tax'
          FROM discrepancy_items
          INNER JOIN Item ON Item.code = discrepancy_items.Itemc
          WHERE discrepancy_items.Vtype = 'S1'
          AND discrepancy_items.Vno = ?
          ORDER BY Item.Compname ASC
        `,
      [VNo]
    );

    return {
      success: true,
      data: rows,
    };

  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: "Failed to fetch data",
    };
  } finally {
    conn.release();
  }
};

export async function getInvoiceByGSTVno(GSTVno) {
  const conn = await pool.getConnection();

  try {
    await sql.connect(config);

    const result = await sql.query(`
      SELECT 
          Acm.name, 
          Acm.address, 
          Acm.address1, 
          Acm.address2,
          Acm.telephone as 'Tel',
          Acm.GSTNo as 'GST No.',
          Acm.DLNO, Acm.DLNO1,
          Salepurchase1.GSTVno AS 'Bill No',
          Salepurchase1.Vno AS 'VNo',
          Salepurchase1.Vtyp AS 'Vtyp',
          CONVERT(VARCHAR(10), Salepurchase1.Vdt, 103) AS 'Dated',
          Salepurchase1.NoOfItem as 'No Of Items',
          Salepurchase1.Uid as 'Made By',
          Salepurchase1.Ouid as 'Print By',
          Salepurchase1.mTime as 'Make Time',
          Salepurchase1.Amt01 + Salepurchase1.disamtit as 'Gross Amt',
          Salepurchase1.disamtit as 'Disc. Amt',
          Salepurchase1.Amt01 as 'Taxable Amt.',
          Salepurchase1.Taxamt as 'Tax Amt',
          Salepurchase1.Amt01 + Salepurchase1.Taxamt as 'Net Amount',
          Salepurchase1.Amt01 + Salepurchase1.Taxamt + Salepurchase1.Rndamt as 'Inv Amt'
      FROM Salepurchase1
      INNER JOIN Acm ON Acm.code = Salepurchase1.Acno
      WHERE Salepurchase1.GSTVno = '${GSTVno}'
      ORDER BY Salepurchase1.Vno ASC
    `);

    return result.recordset;

  } catch (err) {
    console.error(err);
    return [];
  } finally {
    if (conn) conn.release();
  }
}

export async function getInvoiceItemsByVdt(VNo, Vdt) {
  try {
    await sql.connect(config);

    const result = await sql.query(`
      SELECT Salepurchase2.Qty,
             Item.Pack as 'PACK',
             Item.Compname as 'COMPANY',
             Item.name AS 'PARTICULARS',
             Salepurchase2.HSNCode AS 'HSN CODE',
             SalePurchase2.Batch as 'Batch No.',
             SalePurchase2.expiry as 'Exp.',
             SalePurchase2.Mrp as 'MRP.',
             SalePurchase2.Ftrate as 'Rate',
             SalePurchase2.Dis as 'DIS%',
             CASE
                WHEN SalePurchase2.CGST > 0 THEN SalePurchase2.CGST
                WHEN SalePurchase2.SGST > 0 THEN SalePurchase2.SGST
                WHEN SalePurchase2.IGST > 0 THEN SalePurchase2.IGST
                ELSE 0
             END AS Tax
      FROM Salepurchase2
      INNER JOIN Item ON Item.code = SalePurchase2.Itemc
      WHERE SalePurchase2.Vtype='S1'
        AND SalePurchase2.Vno= ${VNo}
        AND Salepurchase2.Vdt >= CONVERT(date, '${Vdt}', 103)
      ORDER BY Item.Compname ASC
    `);

    return result.recordset;

  } catch (err) {
    console.error(err);
    return [];
  }
}